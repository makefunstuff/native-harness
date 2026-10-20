#!/usr/bin/env node
// The shared bench: run tickets against pi in-process, one arm at a time, appending one row per run.
//
//   node bench/run.ts [options]
//     --bench NAME      pi-extras (default) | d3-context | llama-native
//     --tasks a,b|all   tickets (default: all under the bench's ticket root)
//     --arms a,b        arms (default: every arm of the bench that is available)
//     --rounds N        rounds per ticket (default 1)
//     --first N         first round number, for extending an existing series
//     --model NAME      provider/model[:thinking] (default per bench)
//     --out PATH        raw rows (default <bench>/results/raw/<arm>.jsonl)
//     --ext PATH        load one more extension (repeatable)
//     --workers N       concurrent runs (default 2; arms with per-run in-process state use 1)
//     --timeout S       per-run wall-clock cap (default 1800)
//     --dry-run         seed and grade without calling a model: the CI check of the harness
//
// Rows are appended as runs finish, so an interrupted series keeps what it measured; finished
// (task, round) pairs are skipped on the next call.
import { join } from "node:path";
import { armSet, pickTickets, type Arm, type ArmConfig } from "./lib/arms.ts";
import { makeAgentDir, runSeries } from "./lib/run.ts";
import { cacheDirFor, flag, opt, useTmpDir } from "./lib/util.ts";

const dry = flag("dry-run");
const set = armSet(opt("bench", "pi-extras"));
const tasks = pickTickets(set.ticketRoot, opt("tasks", "all"));
const want = opt("arms", "")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
const missing = want.filter((w) => !set.arms.some((a) => a.name === w));
if (missing.length) {
	console.error(`no arm named ${missing.join(", ")} in bench ${set.name}: ${set.arms.map((a) => a.name).join(", ")}`);
	process.exit(2);
}
const arms = want.length ? set.arms.filter((a) => want.includes(a.name)) : set.arms;
const extensions = process.argv.slice(2).flatMap((a, i, all) => (all[i - 1] === "--ext" ? [a] : []));
const cfg: ArmConfig = { dryRun: !!dry };

useTmpDir(join(cacheDirFor(set.cacheName), "tmp"));
const cache = cacheDirFor(set.cacheName);
let agentDir = "";

const armHooks = (arm: Arm) => ({
	start: (ctx: any) => arm.hooks?.(ctx, cfg).start?.(ctx),
	after: (ctx: any) => arm.hooks?.(ctx, cfg).after?.(ctx),
});

for (const arm of arms) {
	const why = arm.available?.() ?? true;
	if (why !== true) {
		console.log(`== ${arm.name}: skipped, ${why}`);
		continue;
	}
	agentDir ||= makeAgentDir(cache, set.cacheName);
	const outPath = opt("out", "") || join(set.resultsRoot, "raw", `${arm.name}.jsonl`);
	console.log(`== ${set.name} / ${arm.name}: ${tasks.map((t) => t.name).join(", ")} x ${opt("rounds", "1")} round(s), model ${arm.model ?? opt("model", set.defaultModel)}${dry ? " (dry run)" : ""}`);
	const rows = await runSeries({
		arm: arm.name,
		tickets: tasks,
		rounds: Number(opt("rounds", "1")),
		firstRound: Number(opt("first", "1")),
		outPath,
		cache,
		agentDir,
		model: arm.model ?? opt("model", set.defaultModel),
		extensionPaths: [...(arm.extensionPaths ?? []), ...extensions],
		extensionFactories: arm.factories ? (ctx) => arm.factories(ctx, cfg) : undefined,
		env: arm.env ? (ctx) => arm.env!(ctx, cfg) : undefined,
		hooks: arm.hooks ? armHooks(arm) : undefined,
		workers: Math.min(Number(opt("workers", "2")), arm.maxWorkers ?? Number(opt("workers", "2"))),
		timeoutS: Number(opt("timeout", "1800")),
		dryRun: dry,
		fields: { bench: set.name, ...arm.fields },
	});
	const passed = rows.filter((r) => r.passed).length;
	if (rows.length) console.log(`== ${arm.name}: ${passed}/${rows.length} passed${dry ? " (dry: the seeded tree as it stands)" : ""}`);
}
