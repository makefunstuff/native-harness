#!/usr/bin/env node
// Generates experimental/d3-context/bench/tasks-long: the long tickets of the context experiment.
//
//   node experimental/d3-context/bench/gen-long-tasks.ts
//
// A long ticket is a task whose answer is spread over tens of thousands of tokens of files, so the
// context router has something to decide about: the run that keeps the evidence answers, the run
// that drops it re-reads the files (and pays for them) or guesses.
//
// Each ticket ends with the instruction to write the answer to `notes.md` citing every fact as
// `file:line`, and its hidden outcome test parses that file: a confident wrong number fails. The
// expected answers are computed from the fixtures as they are written, and the reference answer the
// generator writes (ref/notes.md) is what the ticket self-test checks the outcome test against.
//
// Tickets are generated data: `tasks-long/` is gitignored, and a series regenerates it.
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apiV2Migration, configValidator, etlPipeline } from "./long-tasks/code-tasks.ts";
import { issueTriage, legacyReport, perfHotspots, releaseA, releaseB } from "./long-tasks/doc-tasks.ts";
import { ciTriage } from "./long-tasks/ci-triage.ts";
import { prodIncidents } from "./long-tasks/prod-incidents.ts";
import { makeWriter, type Task } from "./long-tasks/util.ts";
import { wideRename } from "./long-tasks/wide-rename.ts";

export const TASKS: Task[] = [
	ciTriage,
	prodIncidents,
	wideRename,
	releaseA,
	releaseB,
	configValidator,
	etlPipeline,
	issueTriage,
	legacyReport,
	perfHotspots,
	apiV2Migration,
];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "tasks-long");

export async function buildAll(root = ROOT) {
	rmSync(root, { recursive: true, force: true });
	const built: string[] = [];
	for (const task of TASKS) {
		const w = makeWriter(root, task.name);
		const out = await task.build(w);
		for (const [rel, text] of Object.entries(out.ref ?? {})) w(`ref/${rel}`, text);
		built.push(task.name);
	}
	return built;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const built = await buildAll();
	console.log(`${built.length} long tickets in ${ROOT}:\n  ${built.join("\n  ")}`);
}
