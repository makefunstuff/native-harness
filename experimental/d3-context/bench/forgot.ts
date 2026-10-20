#!/usr/bin/env node
// Did it forget something it needed?
//
//   node experimental/d3-context/bench/forgot.ts [--show] [--raw DIR]
//
// For every output the router removed (dropped or shortened), the calls that read one of the same
// files again afterwards. A re-read is the cost of a drop: the work the removal caused. For a base
// run there is no removal, so the same count over every file-reading output is the background rate
// of going back to a file — the number the d3 arm must be compared against.
//
// One line per run, then a total per arm. --show lists the d3 cases to read in the transcripts.
import { existsSync, globSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callsOf, entriesOfSessionDir } from "../../../bench/lib/session.ts";
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
	const show = argv.includes("--show");
	const totals: Record<string, [number, number, number]> = {};
	for (const file of globSync(join(raw, "*.jsonl")).sort()) {
		const arm = basename(file, ".jsonl");
		let runs = 0,
			items = 0,
			back_ = 0,
			seen = 0;
		for (const row of readRows(file) as any[]) {
			if (Number(row.round ?? 1) < 1) continue;
			seen++;
			const name = `${row.task}-r${row.round}`;
			const sess = row.session_dir ? expand(String(row.session_dir)) : join(dirname(file), arm, `${name}.session`);
			if (!existsSync(sess)) continue;
			const cs = callsOf(entriesOfSessionDir(sess));
			const at = new Map(cs.map((c, i) => [c.id, i] as [string, number]));
			const itemsOf = new Map<string, { label: string; decision: string }>();
			if (arm.startsWith("d3")) {
				for (const [k, v] of removedItems(d3LogPath(dirname(file), String(row.task), Number(row.round), arm))) itemsOf.set(k, { label: v.label, decision: v.decision });
			} else {
				// every earlier call that read files counts as "could have been removed"
				for (const c of cs) if (c.paths.size) itemsOf.set(c.id, { label: c.text, decision: "read" });
			}
			const back: string[] = [];
			for (const [key, it] of itemsOf) {
				const i = at.get(key);
				if (i === undefined) continue;
				const c = cs[i];
				if (!c.paths.size) continue;
				items++;
				const later = cs.slice(i + 1).find((x) => [...x.paths].some((p) => c.paths.has(p)));
				if (later) back.push(`${it.decision}: ${it.label.slice(0, 90)} -> re-read ${[...x2(c.paths, later.paths)].join(", ")}: ${later.text.slice(0, 120)}`);
			}
			runs++;
			back_ += back.length;
			console.log(`${arm} ${name}: ${back.length} of ${itemsOf.size} file-reading outputs were followed by a re-read of the same file`);
			if (show && arm.startsWith("d3")) for (const b of back) console.log(`    ${b}`);
		}
		if (!runs && seen) console.log(`${arm}: ${seen} rows and no session to read — transcripts live in the bench cache, outside the repo; run the series here first`);
		if (runs) totals[arm] = [runs, items, back_];
	}
	for (const [arm, [r, i, b]] of Object.entries(totals))
		console.log(`TOTAL ${arm}: ${r} runs, ${i} file-reading outputs ${arm.startsWith("d3") ? "removed by d3" : "(all)"}, ${b} followed by a re-read of the same file (${Math.round((100 * b) / Math.max(1, i))}%)`);
}

const x2 = (a: Set<string>, b: Set<string>) => [...a].filter((p) => b.has(p)).sort();

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
