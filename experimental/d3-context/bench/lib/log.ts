// Reading of the d3-context extension's own log: one JSON line per decision the router made.
//
// The extension logs `start`, `request`, `check` (a decision pass), `decide` (a call to the small
// model: one for the boundary, one per item), `pin`, `apply` (items dropped or summarised) and
// `error`. Every run of the bench gets its own log, named
// `<out-dir>/<task>-r<round>.<arm>.jsonl` by the arm's factory — the name the recorded runs of
// February 2026 use, so the report reads those logs too.
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { PATH_RE, type Call } from "../../../../bench/lib/session.ts";

export interface D3Log {
	start: any;
	/** Decision passes the router ran (a `check`). */
	checks: number;
	/** Calls to the small model (a `decide`). */
	calls: number;
	/** Tokens the small model used: the cost of the router itself. */
	callTokens: { in: number; out: number };
	/** Seconds the router spent, from its own `d3_ms` on each apply. */
	d3Ms: number;
	applies: number;
	appliedTurns: Set<number>;
	drops: number;
	summaries: number;
	kept: number;
	savedChars: number;
	pins: number;
	errors: string[];
}

export function parseD3Log(path: string): D3Log {
	const out: D3Log = {
		start: {},
		checks: 0,
		calls: 0,
		callTokens: { in: 0, out: 0 },
		d3Ms: 0,
		applies: 0,
		appliedTurns: new Set(),
		drops: 0,
		summaries: 0,
		kept: 0,
		savedChars: 0,
		pins: 0,
		errors: [],
	};
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return out; // a run of an arm that is not the router has no log
	}
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let rec: any;
		try {
			rec = JSON.parse(line);
		} catch {
			continue;
		}
		switch (rec.kind) {
			case "start":
				out.start = rec;
				break;
			case "check":
				out.checks++;
				break;
			case "decide":
				out.calls++;
				out.callTokens.in += rec.usage?.input_tokens ?? 0;
				out.callTokens.out += rec.usage?.output_tokens ?? 0;
				break;
			case "apply":
				out.applies++;
				out.appliedTurns.add(rec.turn);
				out.savedChars += rec.saved_chars ?? 0;
				out.d3Ms += rec.d3_ms ?? 0;
				for (const it of rec.items ?? []) {
					if (it.decision === "drop") out.drops++;
					else if (it.decision === "summarize") out.summaries++;
					else out.kept++;
				}
				break;
			case "pin":
				out.pins++;
				break;
			case "error":
				out.errors.push(String(rec.error));
				break;
		}
	}
	return out;
}

/**
 * The outputs the router removed, by the id of the tool call that produced them (the extension keys
 * an item by `toolCallId`; its own notes are keyed `a:<timestamp>`). The turn is the agent turn at
 * which the edit was made, so the edit is in every request after it.
 */
export function removedItems(path: string): Map<string, { label: string; decision: string; turn: number }> {
	const out = new Map<string, { label: string; decision: string; turn: number }>();
	if (!existsSync(path)) return out;
	for (const line of readFileSync(path, "utf8").split("\n")) {
		let rec: any;
		try {
			rec = JSON.parse(line);
		} catch {
			continue;
		}
		if (rec.kind !== "apply") continue;
		for (const it of rec.items ?? []) {
			if (it.decision === "keep") continue;
			out.set(it.key, { label: String(it.label ?? ""), decision: String(it.decision ?? ""), turn: Number(rec.turn ?? 0) });
		}
	}
	return out;
}

/** The extension log of a run: `<out-dir>/<task>-r<round>.<arm>.jsonl`. */
export function d3LogPath(outDir: string, task: string, round: number, arm: string): string {
	return `${outDir}/${task}-r${round}.${arm}.jsonl`;
}

/**
 * The files whose output the router removed. An item's label is the tool's own label ("read
 * src/foo.ts", "cat notes.md"), so the paths come out of it the same way they come out of a call.
 */
export function droppedPaths(path: string): Set<string> {
	const out = new Set<string>();
	if (!existsSync(path)) return out;
	for (const line of readFileSync(path, "utf8").split("\n")) {
		let rec: any;
		try {
			rec = JSON.parse(line);
		} catch {
			continue;
		}
		if (rec.kind !== "apply") continue;
		for (const it of rec.items ?? []) {
			if (it.decision === "keep") continue;
			const label = String(it.label ?? "");
			for (const m of label.match(PATH_RE) ?? []) out.add(m.replace(/^\.\//, ""));
		}
	}
	return out;
}

/** The files an item (a tool call's output) is about. */
export const pathsOfLabel = (label: string) => new Set((label.match(PATH_RE) ?? []).map((p) => p.replace(/^\.\//, "")));

/**
 * Calls that read a file the router had removed: the cost side of every drop. A re-read of a file
 * that is still in the context is the background rate of going back (`rereads` in the session
 * stats); these are the ones the router caused. The call whose output was removed is not a refetch:
 * the removal is of its result, and the cost is what comes after it.
 */
export function refetchesOf(calls: Call[], removals: Map<string, { label: string; decision: string; turn: number }>): { n: number; cases: string[] } {
	const removed = new Map<string, string>(); // path -> the item that removed it
	for (const [key, it] of removals) for (const p of pathsOfLabel(it.label)) removed.set(p, key);
	const cases: string[] = [];
	let n = 0;
	for (const c of calls) {
		const hit = [...c.paths].filter((p) => removed.has(p) && removed.get(p) !== c.id);
		if (!hit.length) continue;
		n++;
		if (cases.length < 10) cases.push(`${hit.join(", ")} <- ${c.name} ${c.text}`.slice(0, 160));
	}
	return { n, cases };
}

export const hasD3Log = (p: string) => existsSync(p);
export const armOf = (rowFile: string) => basename(rowFile, ".jsonl");
