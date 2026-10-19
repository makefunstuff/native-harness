// Tables from results/*.jsonl (or $LOCAL_EDIT_RESULTS) -> results/summary.md and stdout.
//
//   node extensions/local-edit/bench/report.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RESULTS, type Row } from "./run.ts";

export function load(dir = RESULTS): Map<string, Row[]> {
	const arms = new Map<string, Row[]>();
	if (!existsSync(dir)) return arms;
	for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
		const rows = readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
		if (rows.length) arms.set(f.slice(0, -6), rows);
	}
	return arms;
}

const frac = (n: number, d: number) => `${n}/${d}` + (d ? ` (${((100 * n) / d).toFixed(1)}%)` : "");
const sum = (rows: Row[], f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

function kinds(rows: Row[]): string {
	const k: Record<string, number> = {};
	for (const r of rows) for (const [a, b] of Object.entries(r.edit_error_kinds ?? {})) k[a] = (k[a] ?? 0) + b;
	return Object.entries(k).sort().map(([a, b]) => `${a} ${b}`).join(", ") || "–";
}

export function armTable(arms: Map<string, Row[]>): string {
	const out = [
		"| arm | model | runs | hidden tests pass | edit calls | edit errors | error kinds | placed loosely | paths repaired | edits dropping ≥3 lines | untouched-code check failed | collateral lines | median wall s |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|---|",
	];
	for (const [arm, rows] of arms) {
		const calls = sum(rows, (r) => r.edit_calls);
		out.push(
			`| ${arm} | ${rows[0].model} | ${rows.length} | ${frac(sum(rows, (r) => Number(r.passed)), rows.length)} | ${calls} | ${frac(sum(rows, (r) => r.edit_errors), calls)} | ${kinds(rows)} | ` +
				`${sum(rows, (r) => r.tolerant_matches)} | ${sum(rows, (r) => r.path_repairs)} | ${sum(rows, (r) => r.edits_dropping_3plus)} | ` +
				`${frac(sum(rows, (r) => Number(r.untouched_broken)), rows.length)} | ${sum(rows, (r) => r.collateral_lines)} | ${median(rows.map((r) => r.wall_s)).toFixed(0)} |`,
		);
	}
	return out.join("\n");
}

export function taskTable(arms: Map<string, Row[]>): string {
	const tasks = [...new Set([...arms.values()].flat().map((r) => r.task))].sort();
	const names = [...arms.keys()];
	const out = [`| task | ${names.map((a) => `${a}: pass · edit errors/calls`).join(" | ")} |`, `|---|${"---|".repeat(names.length)}`];
	for (const t of tasks) {
		const cells = names.map((a) => {
			const rs = arms.get(a)!.filter((r) => r.task === t);
			return rs.length ? `${sum(rs, (r) => Number(r.passed))}/${rs.length} · ${sum(rs, (r) => r.edit_errors)}/${sum(rs, (r) => r.edit_calls)}` : "–";
		});
		out.push(`| ${t} | ${cells.join(" | ")} |`);
	}
	return out.join("\n");
}

function main() {
	const arms = load();
	if (!arms.size) {
		console.log("no results");
		return;
	}
	const md = `# local-edit bench results\n\n${armTable(arms)}\n\n## Per ticket\n\n${taskTable(arms)}\n`;
	writeFileSync(join(RESULTS, "summary.md"), md);
	console.log(md);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
