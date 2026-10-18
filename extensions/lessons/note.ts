// Lesson notes: the cue / lesson / evidence / confidence record, the ```lesson block the agent
// writes them in, size caps, ids, and the plain-text matcher used when no semantic recall is
// available. Pure functions, no pi and no I/O.
import { createHash } from "node:crypto";

export interface Note {
	id: string; // "lesson-" + hash of repo and normalised cue: the same cue in the same repo is the same note
	repo: string;
	cue: string; // when the lesson applies, in the words a future task would use
	lesson: string; // what to do (or not do)
	evidence: string; // what failed and what fixed it
	confidence: number; // 0..1
	created: string; // ISO time
	updated: string; // ISO time of the last write, confirmation or merge
	hits: number; // how often it was written again, merged or confirmed
	synced?: boolean; // local copy only: false while a Hindsight write is still owed
}

export const LIMITS = { cue: 200, lesson: 500, evidence: 400 };

export function clip(s: string, max: number): string {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function noteId(repo: string, cue: string): string {
	const norm = tokens(cue).sort().join(" ") || cue.toLowerCase().trim();
	return `lesson-${createHash("sha256").update(`${repo}\n${norm}`).digest("hex").slice(0, 16)}`;
}

export function clampConfidence(x: unknown, fallback = 0.6): number {
	const n = typeof x === "number" ? x : Number(x);
	if (!Number.isFinite(n)) return fallback;
	return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

export function makeNote(repo: string, f: { cue: string; lesson: string; evidence?: string; confidence?: unknown }, now = new Date()): Note {
	const cue = clip(f.cue, LIMITS.cue);
	const t = now.toISOString();
	return {
		id: noteId(repo, cue),
		repo,
		cue,
		lesson: clip(f.lesson, LIMITS.lesson),
		evidence: clip(f.evidence ?? "", LIMITS.evidence),
		confidence: clampConfidence(f.confidence),
		created: t,
		updated: t,
		hits: 1,
	};
}

// What the agent answers to the end-of-session request: zero or more blocks
//
//   ```lesson
//   cue: …
//   lesson: …
//   evidence: …
//   confidence: 0.7
//   ```
//
// plus optional `confirms: L1, L2` / `contradicts: L3` lines (inside a block or on their own), or
// "no lesson". Field values may continue on the following lines.
export interface Reply {
	notes: Array<{ cue: string; lesson: string; evidence: string; confidence: number }>;
	confirms: string[]; // shown labels (L1…) or note ids
	contradicts: string[];
}

const FIELD = /^\s*[-*]?\s*(cue|lesson|evidence|confidence|confirms|contradicts)\s*:\s*(.*)$/i;

export function parseReply(text: string): Reply {
	const out: Reply = { notes: [], confirms: [], contradicts: [] };
	const refs = (v: string) => v.split(/[\s,;]+/).map((s) => s.replace(/[^\w-]/g, "")).filter(Boolean);
	const blocks = [...text.matchAll(/```+\s*lesson[^\n]*\n([\s\S]*?)```+/gi)].map((m) => m[1]);
	const loose = text.replace(/```+\s*lesson[^\n]*\n[\s\S]*?```+/gi, "");
	for (const body of blocks) {
		const f: Record<string, string> = {};
		let key: string | undefined;
		for (const line of body.split("\n")) {
			const m = FIELD.exec(line);
			if (m) {
				key = m[1].toLowerCase();
				f[key] = m[2].trim();
			} else if (key && line.trim()) f[key] += ` ${line.trim()}`;
		}
		if (f.confirms) out.confirms.push(...refs(f.confirms));
		if (f.contradicts) out.contradicts.push(...refs(f.contradicts));
		if (f.cue && f.lesson) out.notes.push({ cue: f.cue, lesson: f.lesson, evidence: f.evidence ?? "", confidence: clampConfidence(f.confidence) });
	}
	for (const line of loose.split("\n")) {
		const m = FIELD.exec(line);
		if (m?.[1].toLowerCase() === "confirms") out.confirms.push(...refs(m[2]));
		if (m?.[1].toLowerCase() === "contradicts") out.contradicts.push(...refs(m[2]));
	}
	out.confirms = [...new Set(out.confirms)];
	out.contradicts = [...new Set(out.contradicts)];
	return out;
}

// ---- plain-text matching ----------------------------------------------------------------------

const STOP = new Set(
	"a an and are as at be by can do does for from has have how i if in into is it its make must not of on or so than that the then this to use was were when where which while with without you your should after before every each new any all one only".split(
		" ",
	),
);

function stem(w: string): string {
	if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
	if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
	if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
	if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
	return w;
}

// Words of a text: camelCase and snake_case split, lower case, stop words dropped, light stemming.
export function tokens(text: string): string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length > 1 && !STOP.has(w))
		.map(stem);
}

// How well each note's cue (and, weaker, its lesson) is covered by the query: the idf-weighted
// share of the cue's words found in the query, plus a quarter of the same for the lesson's words.
export function rankByText(query: string, notes: Note[]): Array<{ note: Note; score: number }> {
	const q = new Set(tokens(query));
	const docs = notes.map((n) => ({ note: n, cue: new Set(tokens(n.cue)), body: new Set(tokens(n.lesson)) }));
	const df = new Map<string, number>();
	for (const d of docs) for (const t of new Set([...d.cue, ...d.body])) df.set(t, (df.get(t) ?? 0) + 1);
	const idf = (t: string) => Math.log(1 + (docs.length + 1) / ((df.get(t) ?? 0) + 0.5));
	const cover = (set: Set<string>) => {
		let all = 0;
		let hit = 0;
		for (const t of set) {
			all += idf(t);
			if (q.has(t)) hit += idf(t);
		}
		return all ? hit / all : 0;
	};
	return docs
		.map((d) => ({ note: d.note, score: cover(d.cue) + 0.25 * cover(d.body) }))
		.sort((a, b) => b.score - a.score);
}

// Two notes say the same thing: same id, or most words of cue and lesson shared.
export function similarity(a: Pick<Note, "cue" | "lesson">, b: Pick<Note, "cue" | "lesson">): number {
	const x = new Set(tokens(`${a.cue} ${a.lesson}`));
	const y = new Set(tokens(`${b.cue} ${b.lesson}`));
	if (!x.size || !y.size) return 0;
	let both = 0;
	for (const t of x) if (y.has(t)) both++;
	return both / Math.min(x.size, y.size);
}

// Merge a new note into an existing one that says the same thing: keep the id and creation time,
// take the newer wording, raise confidence a little, keep the newest evidence.
export function merge(old: Note, fresh: Note, now = new Date()): Note {
	return {
		...old,
		cue: fresh.cue.length >= old.cue.length * 0.6 ? fresh.cue : old.cue,
		lesson: fresh.lesson,
		evidence: fresh.evidence || old.evidence,
		confidence: clampConfidence(Math.max(old.confidence, fresh.confidence) + 0.1),
		updated: now.toISOString(),
		hits: old.hits + 1,
	};
}

// Ranking for eviction when a repo's library is over its cap: confidence, decayed by age since
// the last write or confirmation (half-life of `halfLifeDays`).
export function keepScore(n: Note, now = Date.now(), halfLifeDays = 60): number {
	const age = Math.max(0, now - Date.parse(n.updated)) / 86_400_000;
	return n.confidence * 0.5 ** (age / halfLifeDays) * (1 + Math.log1p(n.hits - 1) * 0.2);
}

export function expired(n: Note, ttlDays: number, now = Date.now()): boolean {
	return ttlDays > 0 && now - Date.parse(n.updated) > ttlDays * 86_400_000;
}

// The message shown to the agent at the start of a task: only the notes that passed the judge.
export function lessonsMessage(shown: Array<{ label: string; note: Note }>): string {
	const lines = shown.map(({ label, note }) => `${label}. When ${note.cue}: ${note.lesson}${note.evidence ? ` (seen: ${note.evidence})` : ""}`);
	return [
		"Lessons from earlier sessions in this repository (they were written after a failure was fixed; check each against the code before relying on it):",
		...lines,
	].join("\n");
}

// The end-of-session request, appended after the agent's last answer when a failure was fixed.
export function askMessage(fixes: Array<{ failed: string; error: string }>, shown: Array<{ label: string; note: Note }>): string {
	const fx = fixes
		.slice(0, 3)
		.map((f) => `- \`${clip(f.failed, 160)}\` failed (${clip(f.error, 200)}), later passed`)
		.join("\n");
	const parts = [
		"[lessons] Something failed in this session and was then fixed:",
		fx,
		"If there is a lesson that would save a future task in this repository from the same mistake, write it as one block (at most two), and nothing else. Do not call tools.",
		"```lesson\ncue: <when it applies, in the words a future task would use>\nlesson: <what to do; one or two sentences>\nevidence: <what failed and what fixed it>\nconfidence: <0.0-1.0>\n```",
		'Skip one-off slips (typos, a wrong path): answer "no lesson" then.',
	];
	if (shown.length) {
		const labels = shown.map((s) => s.label).join(", ");
		parts.push(`Lessons ${labels} were shown at the start. Add a line \`contradicts: L…\` for any that proved wrong here, \`confirms: L…\` for any that helped.`);
	}
	return parts.join("\n");
}
