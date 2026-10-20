#!/usr/bin/env node
// The context report: what the router saved, and what it cost.
//
//   node experimental/d3-context/bench/context-report.ts [--raw DIR] [--out FILE] [--show]
//
// One row per arm and task: the run counts (pass, wall, tokens, cost, context peak and mean,
// compactions), the re-reads (files the agent went back to), and from the extension's own log for
// that run: calls to the small model, items dropped, items summarised, characters saved, seconds
// spent. The point of the experiment is the pair "context" against "refetch": the router only pays
// for itself when the context it saves is worth more than what the agent reads back.
//
// This writes results/context.md. The recorded results/summary.md and RESULTS.md are data from the
// runs of February 2026 and are never rewritten.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadArms, num, passRate, perf, stats, tbl } from "../../../bench/lib/report.ts";
import { callsOf, entriesOfSessionDir, sessionStats } from "../../../bench/lib/session.ts";
import { fmt, mean, readRows } from "../../../bench/lib/util.ts";
import { d3LogPath, parseD3Log, refetchesOf, removedItems } from "./lib/log.ts";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(HERE, "results", "raw");
const expand = (p: string) => p.replace(/^~/, homedir());

export interface RunAnalysis {
	arm: string;
	task: string;
	round: number;
	rows: number;
	pass: number;
	wall: number;
	in: number;
	out: number;
	cost: number;
	ctx_peak: number;
	ctx_mean: number;
	compactions: number;
	rereads: number;
	refetches: number;
	calls: number;
	drops: number;
	summaries: number;
	saved_chars: number;
	d3_s: number;
	cases: string[];
}

/** One run: its row, its extension log, its session. Missing inputs count as zero, not as an error. */
export function analyseRow(row: any, rawDir: string): RunAnalysis {
	const arm = String(row.arm ?? basename(rawDir));
	const task = String(row.task);
	const round = Number(row.round ?? 1);
	const logPath = d3LogPath(dirname(row._file ?? RAW), task, round, arm);
	const log = existsSync(logPath) ? parseD3Log(logPath) : null;
	const sess = row.session_dir ? expand(String(row.session_dir)) : "";
	const entries = sess && existsSync(sess) ? entriesOfSessionDir(sess) : [];
	const calls = callsOf(entries);
	const removals = removedItems(logPath);
	const st = entries.length ? sessionStats(entries) : ({} as any);
	const re = refetchesOf(calls, removals);
	// an arm records its own numbers in the row; the extension log is the fallback
	const at = (k: string, v: number) => (typeof row[k] === "number" ? row[k] : v);
	return {
		arm,
		task,
		round,
		rows: 1,
		pass: row.passed === true ? 1 : 0,
		wall: num(row, "wall_s"),
		in: num(row, "in_miss", "in") + num(row, "in_hit", "cache_read"),
		out: num(row, "out"),
		cost: num(row, "cost_usd", "cost"),
		ctx_peak: num(row, "ctx_peak"),
		ctx_mean: num(row, "ctx_mean"),
		compactions: num(row, "compactions"),
		rereads: num(row, "rereads"),
		refetches: re.n,
		calls: at("d3_calls", log?.calls ?? 0),
		drops: at("d3_dropped", log?.drops ?? 0),
		summaries: at("d3_summarised", log?.summaries ?? 0),
		saved_chars: at("d3_saved_chars", log?.savedChars ?? 0),
		d3_s: at("d3_ms", log?.d3Ms ?? 0) / 1000,
		cases: re.cases,
	};
}

/** Rows of a raw file, each analysed. `rawFile` is `<results>/raw/<arm>.jsonl`. */
export function analyseArm(rawFile: string): RunAnalysis[] {
	return (readRows(rawFile) as any[]).map((r) => {
		Object.defineProperty(r, "_file", { value: rawFile, enumerable: false });
		return analyseRow(r, dirname(rawFile));
	});
}

export function main(argv: string[]) {
	const opt = (name: string, d: string) => {
		const i = argv.indexOf(`--${name}`);
		return i >= 0 ? argv[i + 1] : d;
	};
	const raw = opt("raw", RAW);
	const out = opt("out", join(HERE, "results", "context.md"));
	const show = argv.includes("--show");
	const arms = loadArms(raw);

	const head = ["arm", "task", "n", "pass", "wall s", "in", "out", "cost", "ctx peak", "ctx mean", "compact", "re-reads", "refetch", "router calls", "dropped", "summarised", "saved chars", "router s"];
	const lines: string[][] = [];
	const cases: string[] = [];
	for (const [arm, rows] of arms) {
		const good = perf(rows);
		const byTask = new Map<string, any[]>();
		for (const r of rows) {
			const t = String(r.task);
			byTask.set(t, [...(byTask.get(t) ?? []), r]);
		}
		for (const [task, rs] of [...byTask.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
			const a = rs.map((r) => analyseRow(r, raw));
			const [p, n] = passRate(rs);
			const cell = (v: number, nd = 0) => (Number.isFinite(v) ? fmt(v, nd) : "");
			lines.push([
				arm,
				task,
				String(n),
				`${Math.round((p / n) * 100)}%`,
				cell(mean(perf(rs).map((r: any) => num(r, "wall_s")))),
				cell(mean(a.map((x) => x.in))),
				cell(mean(a.map((x) => x.out))),
				cell(mean(a.map((x) => x.cost)), 2),
				cell(stats(rs, "ctx_peak").mean),
				cell(stats(rs, "ctx_mean").mean),
				cell(stats(rs, "compactions").mean),
				cell(mean(a.map((x) => x.rereads))),
				cell(mean(a.map((x) => x.refetches))),
				cell(mean(a.map((x) => x.calls))),
				cell(mean(a.map((x) => x.drops))),
				cell(mean(a.map((x) => x.summaries))),
				cell(mean(a.map((x) => x.saved_chars))),
				cell(mean(a.map((x) => x.d3_s))),
			]);
			for (const run of a) for (const c of run.cases) if (cases.length < 40) cases.push(`${arm}/${run.task}-r${run.round}: ${c}`);
		}
	}

	const body = [
		"# The context experiment: what the router saved, and what it cost",
		"",
		"Generated by `experimental/d3-context/bench/context-report.ts` from `results/raw/`, each run's",
		"extension log and each run's session.",
		"",
		"`ctx peak` and `ctx mean` are the size of the model's context in tokens; `compact` is how",
		"often pi compacted by itself. `re-reads` counts calls that read a file the session had",
		"already read (the background rate of going back); `refetch` counts calls that read a file the",
		"router had removed — the cost side of every drop. The last five columns come from the",
		"extension's own log: decision passes, calls to the small model, items dropped, summarised, characters",
		"saved, seconds spent.",
		"",
		"`refetch` needs the run's session, which lives in the bench cache and not in the repo: on a",
		"fresh clone that column is empty until the series has been run here. The router columns come",
		"from the row itself (the arm measures its own effect) and from the decision-log archive:",
		"`tar -xJf results/raw-artifacts.tar.xz -C results` puts every run's log, diff and stderr next",
		"to the rows, where this report finds them.",
		"",
		tbl([head, ...lines]),
		"",
	];
	if (show && cases.length) body.push("## What was read back", "", ...cases.map((c) => `- ${c}`), "");
	writeFileSync(out, body.join("\n") + "\n");
	console.log(`wrote ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
