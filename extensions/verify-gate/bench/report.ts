#!/usr/bin/env node
// Tables from results/*.jsonl -> results/summary.md (and stdout).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RESULTS = join(dirname(fileURLToPath(import.meta.url)), "results");
type Row = Record<string, any>;

export function load(dir = RESULTS): Map<string, Row[]> {
	const arms = new Map<string, Row[]>();
	if (!existsSync(dir)) return arms;
	for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
		const rows = readFileSync(join(dir, f), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
		if (rows.length) arms.set(f.slice(0, -6), rows);
	}
	return arms;
}

const median = (xs: number[]) => {
	if (!xs.length) return 0;
	const s = [...xs].sort((a, b) => a - b);
	return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const frac = (n: number, d: number) => `${n}/${d}` + (d ? ` (${Math.round((100 * n) / d)}%)` : "");
const count = (rows: Row[], f: (r: Row) => boolean) => rows.filter(f).length;

export function armTable(arms: Map<string, Row[]>): string {
	const out = [
		"| arm | model | runs | hidden tests pass | timed out | own tests green, hidden fail | gate sent back | then passed | gave up | median wall s | median turns | output tok/run |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|",
	];
	for (const [arm, rows] of arms) {
		const sent = rows.filter((r) => r.gate_rounds > 0);
		out.push(
			`| ${arm} | ${rows[0].model} | ${rows.length} | ${frac(count(rows, (r) => r.passed), rows.length)} | ${count(rows, (r) => r.timed_out)} | ` +
				`${frac(count(rows, (r) => r.self_confirmed), rows.length)} | ${sent.length} | ${count(sent, (r) => r.passed)}/${sent.length} | ` +
				`${count(rows, (r) => r.gate_gave_up)} | ${median(rows.map((r) => r.wall_s)).toFixed(0)} | ${median(rows.map((r) => r.assistant_turns)).toFixed(0)} | ` +
				`${mean(rows.map((r) => r.output_tokens)).toFixed(0)} |`,
		);
	}
	return out.join("\n");
}

// Only the local model's numbers compare: cloud usage reports cache writes apart from input.
export function cacheTable(arms: Map<string, Row[]>): string {
	const out = ["| arm | prompt tokens from cache, all requests | requests right after a gate message: from cache |", "|---|---|---|"];
	for (const [arm, rows] of arms) {
		if (!String(rows[0].model).startsWith("llama.cpp/")) continue;
		const sum = (k: string) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
		const [inp, cr, gi, gc] = [sum("input_tokens"), sum("cache_read_tokens"), sum("after_gate_input"), sum("after_gate_cache_read")];
		const after = gi + gc ? `${Math.round((100 * gc) / (gi + gc))}% (${gi} new tokens over ${count(rows, (r) => r.gate_rounds > 0)} runs)` : "–";
		out.push(`| ${arm} | ${inp + cr ? `${Math.round((100 * cr) / (inp + cr))}%` : "–"} | ${after} |`);
	}
	return out.join("\n");
}

export function taskTable(arms: Map<string, Row[]>): string {
	const names = [...arms.keys()];
	const tasks = [...new Set([...arms.values()].flat().map((r) => r.task))].sort();
	const out = [`| task | ${names.join(" | ")} |`, `|---|${names.map(() => "---|").join("")}`];
	for (const t of tasks) {
		const cells = names.map((a) => {
			const rs = arms.get(a)!.filter((r) => r.task === t);
			return rs.length ? `${count(rs, (r) => r.passed)}/${rs.length}` : "–";
		});
		out.push(`| ${t} | ${cells.join(" | ")} |`);
	}
	return out.join("\n");
}

export function report(arms = load()): string {
	if (!arms.size) return "no results\n";
	const local = [...arms.values()].some((rows) => String(rows[0].model).startsWith("llama.cpp/"));
	return [
		"# verify-gate bench",
		armTable(arms),
		...(local ? ["Prompt cache (local model: share of prompt tokens the server did not have to re-read):", cacheTable(arms)] : []),
		"Hidden tests passed, per task:",
		taskTable(arms),
	].join("\n\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const md = report();
	if (existsSync(RESULTS)) writeFileSync(join(RESULTS, "summary.md"), md);
	process.stdout.write(md);
}
