#!/usr/bin/env node
// house-rules 1.4.2 — repository policy check for the ledger library (run by `npm test`).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const strip = (s) => s.replace(/\/\/.*$/gm, "");
const LEGACY_TESTS = new Set(["percent.ts", "sum.ts"]); // tested in tests/money.spec.ts before 1.4

const problems = [];
const ops = readdirSync(join(root, "src/ops")).filter((f) => f.endsWith(".ts"));
const docs = existsSync(join(root, "docs/operations.md")) ? read("docs/operations.md") : "";
const codesSrc = existsSync(join(root, "src/codes.ts")) ? strip(read("src/codes.ts")) : "";
const known = new Set([...codesSrc.matchAll(/["'`]([A-Z][A-Z0-9_]*)["'`]/g)].map((m) => m[1]));

for (const f of ops) {
	const src = strip(read(`src/ops/${f}`));
	const fns = [...src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]);
	for (const fn of fns) {
		if (!new RegExp(`^##\\s+\`?${fn}\`?\\s*$`, "m").test(docs)) {
			problems.push(`src/ops/${f}: ${fn} is not documented in docs/operations.md (add a "## ${fn}" section)`);
		}
	}
	const base = f.replace(/\.ts$/, "");
	if (!LEGACY_TESTS.has(f) && !existsSync(join(root, "tests/ops", `${base}.spec.ts`))) {
		problems.push(`src/ops/${f} has no test file tests/ops/${base}.spec.ts (every operation is tested in its own file)`);
	}
	for (const m of src.matchAll(/LedgerError\(\s*["'`]([A-Z][A-Z0-9_]*)["'`]/g)) {
		if (!known.has(m[1])) problems.push(`error code ${m[1]} (src/ops/${f}) is not in src/codes.ts (the billing service only translates the codes listed there)`);
	}
}

if (problems.length) {
	console.error(`house-rules: ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
	for (const p of [...new Set(problems)]) console.error(`  ${p}`);
	process.exit(1);
}
console.log("house-rules: ok");
