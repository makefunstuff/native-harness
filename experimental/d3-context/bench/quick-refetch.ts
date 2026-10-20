#!/usr/bin/env node
// The quick version: a removal whose file is read again within the next few turns.
//
//   node experimental/d3-context/bench/quick-refetch.ts [--show] [--raw DIR] [--window 3]
//
// A candidate for "forgot something it needed": an output the router removed whose file is read
// again within the next `--window` agent turns after the edit took effect, plus every agent message
// that mentions the removal (the agent noticing that something is missing). For a base run there is
// nothing to compare a removal against, so the base rate is the share of file-reading outputs
// re-read within the same window of their own call.
import { globSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { entriesOfSessionDir, turnsOf } from "../../../bench/lib/session.ts";
import { readRows } from "../../../bench/lib/util.ts";
import { d3LogPath, removedItems } from "./lib/log.ts";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..");
const expand = (p: string) => p.replace(/^~/, homedir());

export function main(argv: string[]) {
	const opt = (name: string, d: string) => {
		const i = argv.indexOf(`--${name}`);
		return i >= 0 ? argv[i + 1] : d;
	};
	const raw = opt("raw", join(HERE, "results", "raw"));
	const window = Number(opt("window", "3"));
	const show = argv.includes("--show");
	for (const file of globSync(join(raw, "*.jsonl")).sort()) {
		const arm = basename(file, ".jsonl");
		let items = 0,
			hits = 0,
			mentions = 0,
			runs = 0,
			seen = 0;
		for (const row of readRows(file) as any[]) {
			if (Number(row.round ?? 1) < 1) continue;
			seen++;
			const name = `${row.task}-r${row.round}`;
			const sess = row.session_dir ? expand(String(row.session_dir)) : join(dirname(file), arm, `${name}.session`);
			const ts = turnsOf(entriesOfSessionDir(sess));
			if (!ts.length) continue;
			runs++;
			// call id -> [turn, paths]: where an output was produced, and which files it read
			const where = new Map<string, [number, Set<string>, string]>();
			ts.forEach((t, ti) => {
				for (const c of t.calls) where.set(c.id, [ti, c.paths, c.text]);
			});
			mentions += ts.filter((t) => t.text.includes("d3-context") || t.text.includes("removed from the context")).length;
			if (!arm.startsWith("d3")) {
				for (const [, [ti, paths]] of where) {
					if (!paths.size) continue;
					items++;
					const back = [...where.values()].some(([tj, q]) => ti < tj && tj <= ti + window && [...paths].some((p) => q.has(p)));
					if (back) hits++;
				}
				continue;
			}
			for (const [key, it] of removedItems(d3LogPath(dirname(file), String(row.task), Number(row.round), arm))) {
				const at = where.get(key);
				if (!at || !at[1].size) continue;
				items++;
				const later = [...where.entries()].filter(([, [tj, q, cmd]]) => it.turn <= tj && tj < it.turn + window && [...at[1]].some((p) => q.has(p)));
				if (later.length) {
					hits++;
					if (show) console.log(`${arm} ${name} turn ${it.turn}: ${it.decision} ${it.label.slice(0, 70)}\n    -> turn ${(later[0][1][0] ?? 0) + 1}: ${(later[0][1][2] ?? "").slice(0, 110)}`);
				}
			}
		}
		if (!runs && seen) console.log(`${arm}: ${seen} rows and no session to read — transcripts live in the bench cache, outside the repo; run the series here first`);
		if (runs) console.log(`${arm}: ${items} file outputs ${arm.startsWith("d3") ? "removed" : "(all)"}, ${hits} re-read within ${window} turns (${Math.round((100 * hits) / Math.max(1, items))}%); agent messages mentioning a removal: ${mentions}`);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
