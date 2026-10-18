// Tolerant matching of edits[].oldText against a file, for the local-edit extension.
//
// resolveEdits() takes the file (LF line endings, no BOM) and the model's edits and returns edits
// whose oldText is the exact text of the file, so pi's own edit tool can apply them unchanged.
// Per edit, in order:
//   1. exact or pi-fuzzy (trailing whitespace, quotes, dashes, NFKC) and unique: left as it is;
//   2. the same with literal "\n" / "\t" escapes decoded (double-escaped arguments);
//   3. indentation-tolerant: whole lines equal once leading/trailing whitespace is ignored;
//   4. similar: a window of whole lines (same line count, one more or one less) whose
//      whitespace-normalised text is >= 0.95 similar (Levenshtein ratio), and no other window
//      that does not overlap it reaches 0.95; a one-line oldText may also match part of a line.
// In 3 and 4 newText is re-indented by the difference between the file's and the model's indent.
// When nothing is accepted the error lists the closest candidate lines with line numbers.

export const SIMILARITY = 0.95;

export interface Edit {
	oldText: string;
	newText: string;
}

export interface Resolution {
	edits: Edit[];
	/** one line per edit that needed more than pi's own matching */
	notes: string[];
}

export class EditMatchError extends Error {}

// pi's normalizeForFuzzyMatch (edit-diff.js), which pi does not export.
export function piNormalize(text: string): string {
	return text
		.normalize("NFKC")
		.split("\n")
		.map((l) => l.trimEnd())
		.join("\n")
		.replace(/[‘’‚‛]/g, "'")
		.replace(/[“”„‟]/g, '"')
		.replace(/[‐‑‒–—―−]/g, "-")
		.replace(/[  -   　]/g, " ");
}

function countOf(hay: string, needle: string): number {
	if (!needle) return 0;
	let n = 0;
	for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) n++;
	return n;
}

/** 1-based line numbers where needle starts in hay. */
function lineNumbersOf(hay: string, needle: string): number[] {
	const out: number[] = [];
	for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) out.push(hay.slice(0, i).split("\n").length);
	return out;
}

/** How pi itself would match: exact, else on pi-normalised text. */
function piMatches(content: string, oldText: string): { count: number; lines: number[] } {
	if (content.includes(oldText)) return { count: countOf(content, oldText), lines: lineNumbersOf(content, oldText) };
	const c = piNormalize(content);
	const o = piNormalize(oldText);
	return { count: countOf(c, o), lines: lineNumbersOf(c, o) };
}

/** "\\n" and "\\t" written literally where a newline / tab was meant. */
export function unescapeLiteral(text: string): string | undefined {
	if (text.includes("\n") || !/\\[nt]/.test(text)) return undefined;
	return text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
}

/** Whitespace-normalised line: trimmed, inner runs of blanks collapsed. */
function norm(line: string): string {
	return line.trim().replace(/[ \t]+/g, " ");
}

function indentOf(line: string): string {
	return /^[ \t]*/.exec(line)![0];
}

/**
 * Levenshtein ratio 1 - d / max(|a|, |b|), computed only far enough to know whether it reaches
 * `floor`; below it returns a lower bound estimate (<= floor).
 */
export function similarity(a: string, b: string, floor = 0): number {
	if (a === b) return 1;
	const m = a.length;
	const n = b.length;
	const len = Math.max(m, n);
	if (len === 0) return 1;
	const maxD = Math.floor((1 - floor) * len);
	if (Math.abs(m - n) > maxD) return 1 - Math.abs(m - n) / len;
	let prev = new Array<number>(n + 1);
	let cur = new Array<number>(n + 1);
	for (let j = 0; j <= n; j++) prev[j] = j;
	for (let i = 1; i <= m; i++) {
		cur[0] = i;
		let rowMin = i;
		const ca = a.charCodeAt(i - 1);
		const lo = Math.max(1, i - maxD);
		const hi = Math.min(n, i + maxD);
		if (lo > 1) cur[lo - 1] = maxD + 1;
		for (let j = lo; j <= hi; j++) {
			const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1));
			cur[j] = v;
			if (v < rowMin) rowMin = v;
		}
		if (hi < n) cur[hi + 1] = maxD + 1;
		if (rowMin > maxD) return Math.min(floor - 1e-9, 1 - rowMin / len);
		[prev, cur] = [cur, prev];
	}
	const d = prev[n];
	return 1 - Math.min(d, len) / len;
}

/**
 * Best approximate occurrence of `pattern` inside `text` (semi-global edit distance):
 * { start, end, ratio } with ratio = 1 - distance / |pattern|.
 */
export function bestSubstring(text: string, pattern: string): { start: number; end: number; ratio: number } {
	const m = pattern.length;
	const n = text.length;
	let prev = new Array<number>(n + 1).fill(0);
	let prevStart = Array.from({ length: n + 1 }, (_, j) => j);
	let cur = new Array<number>(n + 1);
	let curStart = new Array<number>(n + 1);
	for (let i = 1; i <= m; i++) {
		cur[0] = i;
		curStart[0] = 0;
		const ca = pattern.charCodeAt(i - 1);
		for (let j = 1; j <= n; j++) {
			const sub = prev[j - 1] + (ca === text.charCodeAt(j - 1) ? 0 : 1);
			const del = prev[j] + 1; // pattern char missing from text
			const ins = cur[j - 1] + 1; // extra text char
			if (sub <= del && sub <= ins) {
				cur[j] = sub;
				curStart[j] = prevStart[j - 1];
			} else if (del <= ins) {
				cur[j] = del;
				curStart[j] = prevStart[j];
			} else {
				cur[j] = ins;
				curStart[j] = curStart[j - 1];
			}
		}
		[prev, cur] = [cur, prev];
		[prevStart, curStart] = [curStart, prevStart];
	}
	let best = 0;
	for (let j = 1; j <= n; j++) if (prev[j] < prev[best]) best = j;
	return { start: prevStart[best], end: best, ratio: m ? 1 - prev[best] / m : 0 };
}

/** Where a and b differ, after their common prefix and suffix: a[p, ea) vs b[p, eb). */
function diffSpan(a: string, b: string): { p: number; ea: number; eb: number } | undefined {
	if (a === b) return undefined;
	let p = 0;
	while (p < a.length && p < b.length && a[p] === b[p]) p++;
	let s = 0;
	while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
	return { p, ea: a.length - s, eb: b.length - s };
}

/**
 * Three-way merge of one line: o = the model's oldText, f = the file, n = the model's newText.
 * Where o misremembers the file in a spot the model does not change, the file's text is kept;
 * where the model rewrites that spot, its newText wins; anything else is a conflict (undefined).
 */
export function merge3(o: string, f: string, n: string): string | undefined {
	const d1 = diffSpan(o, f);
	if (!d1) return n;
	const d2 = diffSpan(o, n);
	if (!d2) return f; // the model keeps this text: keep the file's version of it
	if (d1.ea < d2.p) return f.slice(0, d1.eb) + o.slice(d1.ea, d2.p) + n.slice(d2.p, d2.eb) + o.slice(d2.ea);
	if (d2.ea < d1.p) return n.slice(0, d2.eb) + o.slice(d2.ea, d1.p) + f.slice(d1.p, d1.eb) + o.slice(d1.ea);
	// the model rewrites the misremembered text (an insertion in the file must fall strictly inside)
	const inside = d1.p === d1.ea ? d2.p < d1.p && d1.p < d2.ea : d2.p <= d1.p && d1.ea <= d2.ea;
	if (inside && d2.ea > d2.p) return n;
	// newText already has the file's text at that spot (the model fixed its own typo)
	if (n.startsWith(f.slice(0, d1.eb))) return n;
	return undefined;
}

/** Longest common subsequence of two line lists under `eq`: matched index pairs, in order. */
function lcs(a: string[], b: string[], eq: (x: string, y: string) => boolean): Array<[number, number]> {
	const m = a.length;
	const n = b.length;
	const t: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) t[i][j] = eq(a[i], b[j]) ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
	const out: Array<[number, number]> = [];
	for (let i = 0, j = 0; i < m && j < n; ) {
		if (eq(a[i], b[j])) out.push([i++, j++]);
		else if (t[i + 1][j] >= t[i][j + 1]) i++;
		else j++;
	}
	return out;
}

const body = (l: string) => l.slice(indentOf(l).length);

/**
 * For a loose whole-line match: carry the file's real text into newText wherever oldText
 * misremembered a line the model does not change, so a near match never writes stale values back.
 * Returns the merged newText (in the model's indentation) and the file lines kept, or a conflict.
 */
function mergeStale(oldLines: string[], win: string[], winStart: number, newText: string): { newText: string; kept: number[] } | { conflict: string } {
	// pair oldText lines with file lines: equal lines first, then the rest of each gap by position
	const anchors = lcs(oldLines, win, (x, y) => norm(x) === norm(y));
	const pairs: Array<[number, number]> = [];
	let pi = 0;
	let pj = 0;
	for (const [ai, aj] of [...anchors, [oldLines.length, win.length] as [number, number]]) {
		const go = oldLines.slice(pi, ai).map((_, k) => pi + k).filter((i) => oldLines[i].trim());
		const gf = win.slice(pj, aj).map((_, k) => pj + k).filter((j) => win[j].trim());
		if (go.length !== gf.length) {
			const extra = go.length > gf.length ? `oldText has a line the file does not have there ("${oldLines[go[gf.length]].trim()}")` : `the file has line ${winStart + gf[go.length] + 1} ("${win[gf[go.length]].trim()}") that oldText leaves out`;
			return { conflict: extra };
		}
		go.forEach((i, k) => pairs.push([i, gf[k]]));
		if (ai < oldLines.length) pairs.push([ai, aj]);
		pi = ai + 1;
		pj = aj + 1;
	}
	const newLines = newText.split("\n");
	const kept: number[] = [];
	const unchanged = new Map(lcs(oldLines, newLines, (x, y) => x === y).map(([i, k]) => [i, k]));
	for (const [i, j] of pairs) {
		const o = oldLines[i];
		const f = win[j];
		if (norm(o) === norm(f)) continue; // indentation only: reindent() handles it
		const k = unchanged.get(i);
		if (k !== undefined) {
			newLines[k] = indentOf(o) + body(f);
			kept.push(winStart + j + 1);
			continue;
		}
		// the model changed this line: merge within it, between its unchanged neighbours
		let lo = 0;
		let hi = newLines.length;
		for (const [oi, nk] of unchanged) {
			if (oi < i) lo = Math.max(lo, nk + 1);
			if (oi > i) hi = Math.min(hi, nk);
		}
		let bestK = -1;
		let bestSim = 0.5;
		for (let c = lo; c < hi; c++) {
			const sim = similarity(norm(newLines[c]), norm(o));
			if (sim > bestSim) [bestK, bestSim] = [c, sim];
		}
		if (bestK === -1) continue; // the model removes this line anyway
		const m = merge3(body(o), body(f), body(newLines[bestK]));
		if (m === undefined)
			return { conflict: `oldText says "${o.trim()}" but line ${winStart + j + 1} of the file is "${f.trim()}", and the edit changes that same text` };
		if (m !== body(newLines[bestK])) kept.push(winStart + j + 1);
		newLines[bestK] = indentOf(newLines[bestK]) + m;
	}
	return { newText: newLines.join("\n"), kept };
}

interface Window {
	start: number; // 0-based first line
	size: number; // number of lines
	score: number;
	exact?: boolean; // score is the Levenshtein ratio (else the bigram Dice score)
	unchecked?: boolean; // could have reached the threshold, but the work budget ran out first
}

/** Re-indent newText from the model's indentation to the file's (tabs and spaces converted). */
export function reindent(newText: string, modelIndent: string, fileIndent: string): string {
	if (modelIndent === fileIndent) return newText;
	const tabs = (s: string) => /^\t+$/.test(s);
	const spaces = (s: string) => /^ +$/.test(s);
	if ((tabs(modelIndent) || !modelIndent) && spaces(fileIndent) && /^\t/m.test(newText)) {
		// tabs in the model's text, spaces in the file: one tab = the file's width per level
		const width = modelIndent && fileIndent.length % modelIndent.length === 0 ? fileIndent.length / modelIndent.length : 4;
		const conv = (t: string) => t.replace(/^\t+/gm, (m) => " ".repeat(m.length * width));
		return reindent(conv(newText), conv(modelIndent), fileIndent);
	}
	if (spaces(modelIndent) && tabs(fileIndent)) {
		// spaces in the model's text, tabs in the file
		const width = modelIndent.length % fileIndent.length === 0 ? modelIndent.length / fileIndent.length : 4;
		const conv = (t: string) => t.replace(/^ +/gm, (m) => "\t".repeat(Math.floor(m.length / width)) + " ".repeat(m.length % width));
		return reindent(conv(newText), conv(modelIndent), fileIndent);
	}
	return newText
		.split("\n")
		.map((line) => {
			if (!line.trim()) return line;
			if (fileIndent.startsWith(modelIndent)) return fileIndent.slice(modelIndent.length) + line;
			if (line.startsWith(modelIndent)) return fileIndent + line.slice(modelIndent.length);
			return line;
		})
		.join("\n");
}

/** Drop from newText the blanks around oldText that were not part of the match. */
function stripLike(newText: string, oldLine: string): string {
	const lead = indentOf(oldLine);
	const trail = /[ \t]*$/.exec(oldLine)![0];
	let t = newText;
	if (lead && t.startsWith(lead)) t = t.slice(lead.length);
	if (trail && t.endsWith(trail)) t = t.slice(0, t.length - trail.length);
	return t;
}

function firstNonBlank(lines: string[]): number {
	const i = lines.findIndex((l) => l.trim() !== "");
	return i === -1 ? 0 : i;
}

function splitOld(oldText: string): { lines: string[]; trailingNewline: boolean } {
	const trailingNewline = oldText.endsWith("\n");
	const lines = (trailingNewline ? oldText.slice(0, -1) : oldText).split("\n");
	return { lines, trailingNewline };
}

// Cost bounds: the window search must stay well under a second on large files, since it runs
// synchronously inside pi. Windows are ranked by bigram overlap (linear time), and the exact
// Levenshtein ratio is computed only for the best few, and only up to EXACT_MAX characters.
const BUCKETS = 4096;
const EXACT_REGIONS = 6; // separate places that get an exact score (so a rival is seen)
const EXACT_PER_REGION = 3; // shifted/resized windows per place
const EXACT_MAX_PLACE = 20_000; // characters: longer oldTexts are not placed loosely
const PLACE_DICE = 0.85; // a window ≥ 95 % Levenshtein-similar always shares more bigrams than this
const EXACT_BUDGET = 1.2e8; // banded Levenshtein cells per search (about 0.2-0.3 s)
const EXACT_MAX_SHOW = 2_500; // characters: longer candidates show the bigram score

function bigrams(line: string): number[] {
	const out: number[] = [];
	for (let i = 0; i + 1 < line.length; i++) out.push((line.charCodeAt(i) * 31 + line.charCodeAt(i + 1)) & (BUCKETS - 1));
	return out;
}

/** Share of the bigrams of `pat` that `text` also has (1 = all of them). */
export function containment(text: string, pat: string): number {
	const p = bigrams(pat);
	if (!p.length) return text.includes(pat) ? 1 : 0;
	const have = new Int32Array(BUCKETS);
	for (const g of bigrams(text)) have[g]++;
	let inter = 0;
	for (const g of p) if (have[g]-- > 0) inter++;
	return inter / p.length;
}

/**
 * Bigram Dice score of every whole-line window of the given size against oldText, in one pass
 * (the window's bigram counts are updated line by line as it slides).
 */
function slideDice(lineGrams: number[][], target: Int32Array, targetTotal: number, size: number): Float64Array {
	const out = new Float64Array(Math.max(0, lineGrams.length - size + 1));
	const w = new Int32Array(BUCKETS);
	let inter = 0;
	let total = 0;
	const add = (gs: number[], d: 1 | -1) => {
		for (const g of gs) {
			if (d === 1) {
				if (w[g] < target[g]) inter++;
				w[g]++;
			} else {
				w[g]--;
				if (w[g] < target[g]) inter--;
			}
		}
		total += d * gs.length;
	};
	for (let i = 0; i < lineGrams.length; i++) {
		add(lineGrams[i], 1);
		if (i >= size) add(lineGrams[i - size], -1);
		if (i >= size - 1) out[i - size + 1] = total + targetTotal ? (2 * inter) / (total + targetTotal) : 1;
	}
	return out;
}

/**
 * Whole-line windows (same line count as oldText, one more, one less) scored against oldText; the
 * best few, best first. score is the Levenshtein ratio for the top EXACT_TOP windows (computed only
 * far enough to know whether it reaches `floor`), and the bigram Dice score for the rest or when
 * the text is longer than EXACT_MAX characters (`exact` says which).
 */
let scoreWindowsLast: Window[] = []; // every window of the last search, unchecked ones included

function scoreWindows(fileLines: string[], oldLines: string[], floor: number, keep: number): Window[] {
	const target = oldLines.map(norm).join("\n");
	const n = oldLines.length;
	const normFile = fileLines.map(norm);
	const grams = normFile.map(bigrams);
	const tBag = new Int32Array(BUCKETS);
	let tTotal = 0;
	for (const l of oldLines.map(norm)) for (const g of bigrams(l)) {
		tBag[g]++;
		tTotal++;
	}
	const cands: Window[] = [];
	for (const size of [n, n - 1, n + 1].filter((s) => s >= 1 && s <= fileLines.length)) {
		const d = slideDice(grams, tBag, tTotal, size);
		d.forEach((score, start) => cands.push({ start, size, score, exact: false }));
	}
	cands.sort((a, b) => b.score - a.score || Math.abs(a.size - n) - Math.abs(b.size - n));
	// exact scores for the best few windows of each of the best few separate places
	const maxLen = floor >= 0.9 ? EXACT_MAX_PLACE : EXACT_MAX_SHOW;
	const regions: Array<{ seed: Window; done: number; best: number }> = [];
	const top: Window[] = [];
	let budget = EXACT_BUDGET;
	let placed = 0; // separate places at or above the floor: two means ambiguous, stop scoring
	for (const c of cands.slice(0, 400)) {
		let region = regions.find((g) => overlaps(g.seed, c));
		if (!region) {
			if (regions.length >= Math.max(EXACT_REGIONS, keep)) continue;
			region = { seed: c, done: 0, best: 0 };
			regions.push(region);
		} else if (region.done >= EXACT_PER_REGION) continue;
		region.done++;
		const text = normFile.slice(c.start, c.start + c.size).join("\n");
		// placing: skip windows that cannot reach 95 %, and a place's shifted windows unless its best one came close
		const worth = floor < 0.9 || (c.score >= PLACE_DICE && (region.done === 1 || region.best >= floor - 0.02));
		const len = Math.max(text.length, target.length);
		const cost = len * (2 * Math.ceil((1 - floor) * len) + 1);
		if (worth && regions.indexOf(region) < EXACT_REGIONS && len <= maxLen) {
			if (placed >= 2 || cost > budget) c.unchecked = floor >= 0.9;
			else {
				budget -= cost;
				const before = region.best;
				c.score = similarity(text, target, floor);
				c.exact = true;
				region.best = Math.max(region.best, c.score);
				if (before < floor && region.best >= floor) placed++;
			}
		}
		top.push(c);
	}
	top.sort((a, b) => b.score - a.score || Math.abs(a.size - n) - Math.abs(b.size - n));
	scoreWindowsLast = top;
	return top.slice(0, keep);
}

function overlaps(a: Window, b: Window): boolean {
	return a.start < b.start + b.size && b.start < a.start + a.size;
}

type Found = { from: number; to: number; newText: string; how: string; lines: string } | { ambiguous: number[] } | { conflict: string } | undefined;

/** Steps 3 and 4 for one oldText. Offsets are into `content`. */
function tolerantFind(content: string, fileLines: string[], lineStart: number[], edit: Edit): Found {
	const { lines: oldLines, trailingNewline } = splitOld(edit.oldText);
	if (!oldLines.some((l) => l.trim())) return undefined;
	const n = oldLines.length;
	const region = (start: number, size: number, how: string): Found => {
		const from = lineStart[start];
		let to = lineStart[start + size - 1] + fileLines[start + size - 1].length;
		if (trailingNewline && to < content.length) to += 1;
		const merged = mergeStale(oldLines, fileLines.slice(start, start + size), start, edit.newText);
		if ("conflict" in merged) return merged;
		const fi = firstNonBlank(fileLines.slice(start, start + size));
		const oi = firstNonBlank(oldLines);
		const newText = reindent(merged.newText, indentOf(oldLines[oi]), indentOf(fileLines[start + fi] ?? ""));
		const kept = merged.kept.length ? `; kept the file's text where oldText differed, at line ${merged.kept.join(", ")}` : "";
		return { from, to, newText, how: how + kept, lines: size === 1 ? `line ${start + 1}` : `lines ${start + 1}-${start + size}` };
	};

	// 3. indentation-tolerant, whole lines
	const target = oldLines.map(norm);
	const starts: number[] = [];
	for (let s = 0; s + n <= fileLines.length; s++) {
		let ok = true;
		for (let i = 0; i < n && ok; i++) ok = norm(fileLines[s + i]) === target[i];
		if (ok) starts.push(s);
	}
	if (starts.length === 1) return region(starts[0], n, "indentation ignored");
	if (starts.length > 1) return { ambiguous: starts.map((s) => s + 1) };

	// 4a. one-line oldText inside a longer line
	if (n === 1) {
		const pat = oldLines[0].trim();
		if (pat.length >= 8) {
			const hits: Array<{ line: number; start: number; end: number; ratio: number }> = [];
			for (let i = 0; i < fileLines.length; i++) {
				const line = fileLines[i];
				if (line.length < pat.length * SIMILARITY - 2) continue;
				// ≥ 95 % similar keeps most bigrams; and bound the quadratic search on long lines
				if (containment(line, pat) < 0.8 || line.length * pat.length > 4_000_000) continue;
				const b = bestSubstring(line, pat);
				if (b.ratio >= SIMILARITY) hits.push({ line: i, ...b });
			}
			if (hits.length > 1) return { ambiguous: hits.map((h) => h.line + 1) };
			if (hits.length === 1) {
				const h = hits[0];
				const whole = h.start <= indentOf(fileLines[h.line]).length && h.end >= fileLines[h.line].trimEnd().length;
				if (whole) return region(h.line, 1, `${Math.round(h.ratio * 100)}% similar`);
				const f = fileLines[h.line].slice(h.start, h.end);
				const n2 = stripLike(edit.newText, oldLines[0]);
				const m = merge3(pat, f, n2);
				if (m === undefined) return { conflict: `oldText says "${pat}" but line ${h.line + 1} of the file has "${f}", and the edit changes that same text` };
				return {
					from: lineStart[h.line] + h.start,
					to: lineStart[h.line] + h.end,
					newText: m,
					how: `${Math.round(h.ratio * 100)}% similar` + (m !== n2 ? `; kept the file's text where oldText differed, at line ${h.line + 1}` : ""),
					lines: `line ${h.line + 1}`,
				};
			}
		}
	}

	// 4b. similar whole-line window
	const ws = scoreWindows(fileLines, oldLines, SIMILARITY, 40).filter((w) => w.exact && w.score >= SIMILARITY);
	if (!ws.length) return undefined;
	const best = ws[0];
	const rivals: Window[] = [];
	const all = scoreWindowsLast;
	for (const w of [...ws, ...all.filter((w) => w.unchecked)]) if (!overlaps(w, best) && !rivals.some((v) => overlaps(v, w))) rivals.push(w);
	if (rivals.length) return { ambiguous: [best.start + 1, ...rivals.map((w) => w.start + 1)] };
	if (ws.some((w) => w !== best && overlaps(w, best) && w.score === best.score && w.size === best.size)) return undefined;
	// the boundary lines must themselves look alike, so a partial first/last line is not dropped
	const fl = fileLines.slice(best.start, best.start + best.size);
	const firstOk = similarity(norm(fl[0]), target[0]) >= 0.8 || !target[0];
	const lastOk = similarity(norm(fl[fl.length - 1]), target[n - 1]) >= 0.8 || !target[n - 1];
	if (!firstOk || !lastOk) return undefined;
	return region(best.start, best.size, `${Math.round(best.score * 1000) / 10}% similar`);
}

/** For a long oldText: where its first and last lines are in the file, when each is there once. */
function anchorNote(fileLines: string[], oldLines: string[]): string {
	const body = oldLines.filter((l) => l.trim());
	if (body.length < 4) return "";
	const where = (line: string) => {
		const hits = fileLines.flatMap((l, i) => (norm(l) === norm(line) ? [i + 1] : []));
		return hits.length === 1 ? hits[0] : undefined;
	};
	const a = where(body[0]);
	const b = where(body[body.length - 1]);
	const parts: string[] = [];
	if (a) parts.push(`its first line is line ${a}`);
	if (b) parts.push(`its last line is line ${b}`);
	if (!parts.length) return "";
	const span = a && b && b > a ? ` (the file has ${b - a + 1} lines there, oldText has ${oldLines.length}: lines in between differ)` : "";
	return `\nFor this oldText: ${parts.join(", ")}${span}.`;
}

/** The closest places to oldText, for the error message. */
export function closestCandidates(content: string, oldText: string, max = 3, context = 0): string {
	const fileLines = content.split("\n");
	const { lines: oldLines } = splitOld(oldText);
	let ws: Window[];
	if (oldLines.length === 1) {
		const pat = oldLines[0].trim();
		// rank lines by bigram containment, then compute the exact score for the best few only
		ws = fileLines
			.map((l, i) => ({ start: i, size: 1, score: l.trim() && pat ? containment(l, pat) : 0 }))
			.sort((a, b) => b.score - a.score)
			.slice(0, 20)
			.map((w) => {
				const l = fileLines[w.start];
				if (!l.trim() || !pat || l.length * pat.length > 4_000_000) return w;
				const b = bestSubstring(l, pat);
				return { ...w, score: Math.max(b.ratio, similarity(norm(l), norm(pat), 0.3)) };
			})
			.sort((a, b) => b.score - a.score);
	} else {
		ws = scoreWindows(fileLines, oldLines, 0, 40);
	}
	const picked: Window[] = [];
	for (const w of ws) {
		if (w.score <= 0.3) break;
		if (picked.some((p) => overlaps(p, w))) continue;
		picked.push(w);
		if (picked.length >= max) break;
	}
	const anchors = anchorNote(fileLines, oldLines);
	if (!picked.length) return `No similar lines found in the file.${anchors} Read the file again before editing.`;
	const width = String(fileLines.length).length;
	const MAXLINES = 12;
	const blocks = picked.map((w) => {
		const from = Math.max(0, w.start - context);
		const to = Math.min(fileLines.length, w.start + w.size + context);
		const shown = fileLines.slice(from, Math.min(to, from + MAXLINES)).map((l, i) => `${String(from + i + 1).padStart(width)}| ${l}`);
		if (to - from > MAXLINES) shown.push(`${"".padStart(width)}| … (${to - from - MAXLINES} more lines)`);
		const label = w.size === 1 ? `line ${w.start + 1}` : `lines ${w.start + 1}-${w.start + w.size}`;
		return `${label} (${Math.round(w.score * 100)}% similar):\n${shown.join("\n")}`;
	});
	return `Closest text in the file:\n${blocks.join("\n")}${anchors}\nCopy oldText exactly from these lines (without the "N| " prefixes), or read the file again.`;
}

/**
 * Turn the model's edits into edits pi's exact matcher accepts. Throws EditMatchError when an
 * edit cannot be placed, with the closest candidates in the message.
 */
export function resolveEdits(content: string, edits: Edit[], path: string): Resolution {
	const fileLines = content.split("\n");
	const lineStart: number[] = [];
	let off = 0;
	for (const l of fileLines) {
		lineStart.push(off);
		off += l.length + 1;
	}
	const out: Edit[] = [];
	const notes: string[] = [];
	const many = edits.length > 1;
	edits.forEach((edit, i) => {
		const label = many ? `edits[${i}]` : "oldText";
		if (typeof edit?.oldText !== "string" || typeof edit?.newText !== "string") {
			out.push(edit);
			return;
		}
		const e = { oldText: edit.oldText.replace(/\r\n?/g, "\n"), newText: edit.newText.replace(/\r\n?/g, "\n") };
		if (!e.oldText) {
			out.push(edit);
			return;
		}
		// 1. pi's own matching
		const pi = piMatches(content, e.oldText);
		if (pi.count === 1) {
			out.push(edit);
			return;
		}
		if (pi.count > 1)
			throw new EditMatchError(
				`${label} matches ${pi.count} places in ${path} (lines ${pi.lines.join(", ")}). Add neighbouring lines to oldText so it matches only one.`,
			);
		// 2. literal escapes
		const unesc = unescapeLiteral(e.oldText);
		const decoded = unesc === undefined ? undefined : { oldText: unesc, newText: unescapeLiteral(e.newText) ?? e.newText };
		if (decoded && piMatches(content, decoded.oldText).count === 1) {
			out.push(decoded);
			notes.push(`${label}: decoded literal \\n escapes`);
			return;
		}
		// 3./4. tolerant: as written first (a "\n" may be part of a string literal), then decoded
		let found = tolerantFind(content, fileLines, lineStart, e);
		if (!found && decoded && piMatches(content, decoded.oldText).count === 0) {
			found = tolerantFind(content, fileLines, lineStart, decoded);
			if (found) Object.assign(e, decoded);
		}
		if (found && "conflict" in found)
			throw new EditMatchError(
				`${label} was not placed in ${path}: ${found.conflict}. oldText must show the file as it is now; re-read those lines and send the edit again.\n${closestCandidates(content, e.oldText)}`,
			);
		if (found && "ambiguous" in found)
			throw new EditMatchError(
				`${label} was not found exactly in ${path}, and similar text appears in several places (lines ${found.ambiguous.join(", ")}). ` +
					`Add neighbouring lines to oldText so it matches only one.\n${closestCandidates(content, e.oldText)}`,
			);
		if (found) {
			const exact = content.slice(found.from, found.to);
			if (countOf(content, exact) !== 1) {
				throw new EditMatchError(`${label} was matched loosely at ${found.lines} of ${path}, but that text is not unique. Add neighbouring lines to oldText.`);
			}
			out.push({ oldText: exact, newText: found.newText });
			notes.push(`${label}: matched ${found.lines} (${found.how})`);
			return;
		}
		const inserter = edits.findIndex((o, j) => j !== i && typeof o?.newText === "string" && piNormalize(o.newText).includes(piNormalize(e.oldText).trim()));
		if (inserter !== -1)
			throw new EditMatchError(
				`${label} is text that edits[${inserter}] of this same call writes. All edits of one call are matched against the file as it was before the call, ` +
					`so ${label} cannot see it: merge the two into one edit, or make this change in a later call.`,
			);
		throw new EditMatchError(
			`Could not find ${many ? `edits[${i}]` : "the text"} in ${path}: no exact match, and no unique match at ≥${Math.round(SIMILARITY * 100)}% similarity.\n` +
				closestCandidates(content, e.oldText),
		);
	});
	return { edits: out, notes };
}
