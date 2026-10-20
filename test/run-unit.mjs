#!/usr/bin/env node
// Unit tests: every *.test.ts / *.test.mjs in the extension folders, the template and test/,
// run with node's test runner (TypeScript through node's type stripping). Benchmark tickets under
// */bench/tasks/ are left out: their bench grades them.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO } from "./lib/harness.mjs";

const roots = ["bench", "extensions", "templates", "experimental/d3-context/extension", "experimental/d3-context/bench/lib", "test"].map((r) => join(REPO, r));
const files = [];
const walk = (dir) => {
	for (const d of readdirSync(dir, { withFileTypes: true })) {
		// bench tickets hold fixture repos whose tests fail on purpose (verify-gate/bench/selftest.ts runs them)
		if (d.name === "node_modules" || d.name === "tickets" || d.name.startsWith(".")) continue;
		if (d.name === "tasks" && dir.endsWith("bench")) continue; // benchmark tickets: graded by their bench, not unit tests
		const p = join(dir, d.name);
		if (/[\\/]bench[\\/]tasks$/.test(p)) continue; // benchmark tickets: their tests are graded by the bench
		if (d.isDirectory()) walk(p);
		else if (/\.test\.(ts|mjs)$/.test(d.name)) files.push(p);
	}
};
for (const r of roots) if (existsSync(r)) walk(r);
if (!files.length) {
	console.log("no unit tests found");
	process.exit(0);
}
console.log(`unit tests: ${files.map((f) => relative(REPO, f)).join(", ")}`);
const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit", cwd: REPO });
process.exit(r.status ?? 1);
