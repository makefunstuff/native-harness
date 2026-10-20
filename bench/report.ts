#!/usr/bin/env node
// Summarise a bench's raw rows into results/summary.md.
//
//   node bench/report.ts [--bench NAME]
import { join } from "node:path";
import { armSet } from "./lib/arms.ts";
import { coreTable, costTable, editTable, loadArms, passRate, section, writeSummary } from "./lib/report.ts";

const args = process.argv.slice(2);
const set = armSet(args.reduce((a: string, s, i, all) => (all[i - 1] === "--bench" ? s : a), ""));
const arms = [...loadArms(join(set.resultsRoot, "raw")).entries()];
if (!arms.length) {
	console.error(`no raw rows under ${join(set.resultsRoot, "raw")}`);
	process.exit(1);
}
const tasks = new Set(arms.flatMap(([, rows]) => rows.map((r) => r.task))).size;
writeSummary(
	join(set.resultsRoot, "summary.md"),
	[
		section(
			"Bench",
			[
				`\`node bench/run.ts --bench ${set.name}\` drives pi in-process through its SDK (\`createAgentSession\`) on the tickets of \`${set.ticketRoot}\`, grading each final tree with the ticket's hidden tests (\`node --test\`).`,
				`Rows: \`${join(set.resultsRoot, "raw")}/*.jsonl\`. Regenerate with \`node bench/report.ts --bench ${set.name}\`.`,
				`Passes are over every run; performance columns exclude provider failures and timeouts.`,
				arms.map(([arm, rows]) => `- \`${arm}\`: ${passRate(rows).join("/")} passed on ${new Set(rows.map((r) => r.task)).size}/${tasks} task(s), ${rows.length} run(s)`).join("\n"),
			],
			coreTable(arms, { cost: true }),
		),
		section("Edits", ["How much of the work is harness-rejected edits."], editTable(arms)),
		section("Cost", ["Tokens per run, and the cost of a passed task at the endpoint's own accounting."], costTable(arms)),
	],
	`# ${set.name} bench summary`,
);
console.log(join(set.resultsRoot, "summary.md"));
