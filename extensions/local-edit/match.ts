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

interface Window {
	start: number; // 0-based first line
	size: number; // number of lines
	score: number;
}

/** Re-indent newText from the model's indentation to the file's. */
export function reindent(newText: string, modelIndent: string, fileIndent: string): string {
	if (modelIndent === fileIndent) return newText;
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

/** Whole-line windows scored against oldText; the best few, best first. */
function scoreWindows(fileLines: string[], oldLines: string[], floor: number, keep: number): Window[] {
	const target = oldLines.map(norm).join("\n");
	const oldSet = new Set(oldLines.map(norm).filter(Boolean));
	const n = oldLines.length;
	const sizes = [n, n - 1, n + 1].filter((s) => s >= 1 && s <= fileLines.length);
	const normFile = fileLines.map(norm);
	// cheap prefilter on long oldTexts: windows sharing the most whole lines
	const hits = normFile.map((l) => (l && oldSet.has(l) ? 1 : 0));
	const prefix = [0];
	for (const h of hits) prefix.push(prefix[prefix.length - 1] + h);
	let cands: Array<{ start: number; size: number; pre: number }> = [];
	for (const size of sizes)
		for (let s = 0; s + size <= fileLines.length; s++) cands.push({ start: s, size, pre: prefix[s + size] - prefix[s] });
	if (n > 4) {
		cands.sort((a, b) => b.pre - a.pre);
		cands = cands.slice(0, 60);
	}
	const out: Window[] = [];
	for (const c of cands) {
		const text = normFile.slice(c.start, c.start + c.size).join("\n");
		out.push({ start: c.start, size: c.size, score: similarity(text, target, floor) });
	}
	out.sort((a, b) => b.score - a.score || Math.abs(a.size - n) - Math.abs(b.size - n));
	return out.slice(0, keep);
}

const overlaps = (a: Window, b: Window) => a.start < b.start + b.size && b.start < a.start + a.size;

type Found = { from: number; to: number; newText: string; how: string; lines: string } | { ambiguous: number[] } | undefined;

/** Steps 3 and 4 for one oldText. Offsets are into `content`. */
function tolerantFind(content: string, fileLines: string[], lineStart: number[], edit: Edit): Found {
	const { lines: oldLines, trailingNewline } = splitOld(edit.oldText);
	if (!oldLines.some((l) => l.trim())) return undefined;
	const n = oldLines.length;
	const region = (start: number, size: number, how: string): Found => {
		const from = lineStart[start];
		let to = lineStart[start + size - 1] + fileLines[start + size - 1].length;
		if (trailingNewline && to < content.length) to += 1;
		const fi = firstNonBlank(fileLines.slice(start, start + size));
		const oi = firstNonBlank(oldLines);
		const newText = reindent(edit.newText, indentOf(oldLines[oi]), indentOf(fileLines[start + fi] ?? ""));
		return { from, to, newText, how, lines: size === 1 ? `line ${start + 1}` : `lines ${start + 1}-${start + size}` };
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
				const b = bestSubstring(line, pat);
				if (b.ratio >= SIMILARITY) hits.push({ line: i, ...b });
			}
			if (hits.length > 1) return { ambiguous: hits.map((h) => h.line + 1) };
			if (hits.length === 1) {
				const h = hits[0];
				const whole = h.start <= indentOf(fileLines[h.line]).length && h.end >= fileLines[h.line].trimEnd().length;
				if (whole) return region(h.line, 1, `${Math.round(h.ratio * 100)}% similar`);
				return {
					from: lineStart[h.line] + h.start,
					to: lineStart[h.line] + h.end,
					newText: stripLike(edit.newText, oldLines[0]),
					how: `${Math.round(h.ratio * 100)}% similar`,
					lines: `line ${h.line + 1}`,
				};
			}
		}
	}

	// 4b. similar whole-line window
	const ws = scoreWindows(fileLines, oldLines, SIMILARITY, 40).filter((w) => w.score >= SIMILARITY);
	if (!ws.length) return undefined;
	const best = ws[0];
	const rivals = ws.filter((w) => !overlaps(w, best));
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
		ws = fileLines
			.map((l, i) => {
				const b = l.trim() && pat ? bestSubstring(l, pat) : { ratio: 0 };
				return { start: i, size: 1, score: Math.max(b.ratio, similarity(norm(l), norm(pat))) };
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
		if (unesc !== undefined) {
			const u = piMatches(content, unesc);
			if (u.count === 1) {
				out.push({ oldText: unesc, newText: unescapeLiteral(e.newText) ?? e.newText });
				notes.push(`${label}: decoded literal \\n escapes`);
				return;
			}
			if (u.count === 0) {
				e.oldText = unesc;
				e.newText = unescapeLiteral(e.newText) ?? e.newText;
			}
		}
		// 3./4. tolerant
		const found = tolerantFind(content, fileLines, lineStart, e);
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
