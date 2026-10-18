#!/usr/bin/env node
// Unit tests: every *.test.ts / *.test.mjs in the extension folders, the template and test/,
// run with node's test runner (TypeScript through node's type stripping).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO } from "./lib/harness.mjs";

const roots = ["extensions", "templates", "experimental/llama-native/extension", "test"].map((r) => join(REPO, r));
const files = [];
const walk = (dir) => {
	for (const d of readdirSync(dir, { withFileTypes: true })) {
		// bench tickets hold fixture repos whose tests fail on purpose (verify-gate/bench/selftest.ts runs them)
		if (d.name === "node_modules" || d.name === "tickets" || d.name.startsWith(".")) continue;
		const p = join(dir, d.name);
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
