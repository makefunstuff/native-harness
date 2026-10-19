#!/usr/bin/env node
// house-rules 1.4.2 — repository policy check for the dayplan library (run by `npm test`).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const LEGACY_DOCS = new Set(["dates.ts"]); // documented by hand before the API docs were generated

const problems = [];
const modules = readdirSync(join(root, "src")).filter((f) => f.endsWith(".ts") && f !== "index.ts");
let changelog = "";
try {
	changelog = read("CHANGELOG.md");
} catch {}

for (const f of modules) {
	const raw = read(`src/${f}`);
	const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
	for (const m of raw.matchAll(/(\/\*\*[\s\S]*?\*\/\s*)?export\s+function\s+(\w+)/g)) {
		const fn = m[2];
		if (!changelog.includes(`\`${fn}\``)) problems.push(`CHANGELOG.md does not mention \`${fn}\` (src/${f}); add a line under "## Unreleased"`);
		if (!LEGACY_DOCS.has(f) && !(m[1] ?? "").includes("@example")) {
			problems.push(`src/${f}: ${fn} has no /** … @example … */ doc comment (the API docs are generated from them)`);
		}
	}
	if (/\.(get|set)(Date|Day|Month|FullYear|Hours)\(|new Date\(\s*[\w.]+\s*,|toLocale\w*\(|getTimezoneOffset/.test(code)) {
		problems.push(`src/${f} uses local-time Date methods; days are UTC calendar days: use getUTCDate()/setUTCDate()/Date.UTC() (see src/dates.ts)`);
	}
}

if (problems.length) {
	console.error(`house-rules: ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
	for (const p of [...new Set(problems)]) console.error(`  ${p}`);
	process.exit(1);
}
console.log("house-rules: ok");
