#!/usr/bin/env node
// Summarise bench/results/<label>.jsonl as markdown tables: base vs guard per label, per
// scenario for injection runs.  node extensions/loop-guard/bench/report.ts [LABEL...]
import { existsSync, readdirSync } from "node:fs";
import { readRows, RESULTS } from "./lib.ts";

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : "-");
const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);

/** The last row per run, without runs cut short by a provider error (they were run again). */
function finalRows(label: string): any[] {
	const last = new Map<string, any>();
	for (const r of readRows(label)) last.set(`${r.arm}/${r.key}/${r.round}`, r);
	return [...last.values()].filter((r) => !r.provider_error);
}

function plain(label: string, rows: any[]) {
	const tasks = [...new Set(rows.map((r) => r.task))].sort();
	const rounds = Math.max(...rows.map((r) => r.round));
	const col = (arm: string) => {
		const rs = rows.filter((r) => r.arm === arm);
		const calls = sum(rs, "calls");
		return {
			runs: rs.length,
			passed: `${sum(rs, "passed")}/${rs.length}`,
			"tool calls / run": rs.length ? (calls / rs.length).toFixed(1) : "-",
			"tool error rate": pct(sum(rs, "errors"), calls),
			"exact retry of a failed call": `${sum(rs, "exactRetry")} (${pct(sum(rs, "exactRetry"), calls)})`,
			"notes: retry / repeat / streak": `${sum(rs, "note_retry")} / ${sum(rs, "note_repeat")} / ${sum(rs, "note_streak")}`,
			"runs ending on a stall": sum(rs, "stall"),
			"stall nudges sent": sum(rs, "nudge_stall"),
			timeouts: sum(rs, "timed_out"),
			"median wall time": rs.length ? `${Math.round(median(rs.map((r) => r.wall_s)))} s` : "-",
		} as Record<string, string | number>;
	};
	const base = col("base"), guard = col("guard");
	const lines = [`### ${label} (${tasks.length} tickets, ${rounds} rounds)`, "", "| | without loop-guard | with loop-guard |", "|---|---:|---:|"];
	for (const k of Object.keys(base)) lines.push(`| ${k} | ${base[k]} | ${guard[k]} |`);
	const per = tasks.map((t) => `${t} ${sum(rows.filter((r) => r.task === t && r.arm === "base"), "passed")}/${sum(rows.filter((r) => r.task === t && r.arm === "guard"), "passed")}`);
	lines.push("", `Passed per ticket (without / with): ${per.join(", ")}.`, "");
	return lines.join("\n");
}

function injection(label: string, rows: any[]) {
	const rounds = Math.max(...rows.map((r) => r.round));
	const lines = [
		`### ${label} (injection, ${rounds} rounds per scenario and arm)`,
		"",
		"| scenario | loop-guard | passed | model's first call repeats the failed call | identical repeats in all | model turns (median) | notes / nudges |",
		"|---|---|---:|---:|---:|---:|---:|",
	];
	for (const sc of [...new Set(rows.map((r) => r.key))].sort())
		for (const arm of ["base", "guard"]) {
			const rs = rows.filter((r) => r.key === sc && r.arm === arm);
			if (!rs.length) continue;
			const notes = sum(rs, "note_retry") + sum(rs, "note_repeat") + sum(rs, "note_streak");
			lines.push(`| ${sc} | ${arm === "guard" ? "with" : "without"} | ${sum(rs, "passed")}/${rs.length} | ${sc === "stall" ? "-" : `${sum(rs, "first_call_repeats")}/${rs.length}`} | ${sc === "stall" ? "-" : sum(rs, "repeats_total")} | ${median(rs.map((r) => r.model_turns))} | ${notes} / ${sum(rs, "nudge_stall")} |`);
		}
	return `${lines.join("\n")}\n`;
}

const labels = process.argv.slice(2).length ? process.argv.slice(2) : !existsSync(RESULTS) ? [] : readdirSync(RESULTS).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6)).sort();
for (const label of labels) {
	const rows = finalRows(label);
	if (!rows.length) continue;
	console.log(rows[0].first_call_repeats !== undefined ? injection(label, rows) : plain(label, rows));
}
