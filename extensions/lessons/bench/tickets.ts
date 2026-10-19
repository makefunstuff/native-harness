// The lessons benchmark's tickets: sequences of related tickets on one small TypeScript repository
// each. Every repo has house rules that nothing in its source shows: a policy checker installed as
// a dev dependency (`house-rules`, run by `npm test` as pretest) states them only when they are
// broken, the way a linter plugin or a CI policy does. Every ticket of a sequence can break the
// same rules again, so a mistake made and fixed on ticket 1 can repeat on tickets 2-5: that
// repetition is what the lessons extension should remove.
//
//   sequences/<seq>/repo/                  the repository every ticket of the sequence starts from
//   sequences/<seq>/house-rules/cli.mjs    its policy checker, installed bundled into node_modules
//   sequences/<seq>/tickets/<n>-<name>/    issue.md, hidden.spec.ts (grading), ref/ (a solution)
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SEQ_DIR = join(HERE, "sequences");

export interface Trap {
	name: string;
	signature: RegExp; // a house-rules message for it: in the agent's own test output it hit the
	// mistake; in the grader's run of the checker the mistake stayed in the final tree
	hiddenTest?: RegExp; // a hidden test whose failure also means it stayed
}

export interface Ticket {
	seq: string;
	name: string; // "1-vat"
	pos: number; // 1-based position in the sequence
	traps: string[]; // the traps this ticket can hit
}

// Signatures name a concrete file or function, so reading the checker itself never matches.
export const TRAPS: Record<string, Trap[]> = {
	ledger: [
		{ name: "docs", signature: /src\/ops\/\w+\.ts: \w+ is not documented in docs\/operations\.md/ },
		{ name: "testfile", signature: /src\/ops\/\w+\.ts has no test file tests\/ops\/\w+\.spec\.ts/ },
		{ name: "codes", signature: /error code [A-Z][A-Z0-9_]* \(src\/ops\/\w+\.ts\) is not in src\/codes\.ts/ },
	],
	dayplan: [
		{ name: "changelog", signature: /CHANGELOG\.md does not mention `\w+`/ },
		{ name: "example", signature: /src\/\w+\.ts: \w+ has no \/\*\* … @example/ },
		{ name: "utc", signature: /src\/\w+\.ts uses local-time Date methods/, hiddenTest: /^\[utc\]/ },
	],
};

// Traps a ticket cannot hit.
const NOT_APPLICABLE: Record<string, string[]> = {};

export function sequences(): string[] {
	return readdirSync(SEQ_DIR).filter((d) => existsSync(join(SEQ_DIR, d, "repo"))).sort();
}

export function tickets(seq: string): Ticket[] {
	return readdirSync(join(SEQ_DIR, seq, "tickets"))
		.filter((d) => /^\d+-/.test(d))
		.sort((a, b) => Number.parseInt(a) - Number.parseInt(b))
		.map((name) => ({
			seq,
			name,
			pos: Number.parseInt(name),
			traps: TRAPS[seq].map((t) => t.name).filter((t) => !(NOT_APPLICABLE[`${seq}/${name}`] ?? []).includes(t)),
		}));
}

export function issue(t: Ticket): string {
	return readFileSync(join(SEQ_DIR, t.seq, "tickets", t.name, "issue.md"), "utf8").trim();
}

export function prompt(t: Ticket): string {
	return `Ticket:\n\n${issue(t)}\n\nWork in the repository in the current directory. Make sure \`npm test\` passes before you finish.`;
}

const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8" });

export function checker(seq: string): string {
	return join(SEQ_DIR, seq, "house-rules", "cli.mjs");
}

// The checker as the dev dependency ships it: a compressed bundle, like most dist/ builds in
// node_modules, so its rules show when they are broken rather than by reading the repo. (A
// determined agent can still unpack it, as it could read a CI config.)
export function bundle(seq: string): string {
	const src = readFileSync(checker(seq), "utf8").replace(/^#!.*\n/, "");
	const packed = gzipSync(src).toString("base64");
	return `#!/usr/bin/env node\n// house-rules 1.4.2 (bundled)\nimport{gunzipSync as g}from"node:zlib";await import("data:text/javascript;base64,"+g(Buffer.from("${packed}","base64")).toString("base64"));\n`;
}

// A fresh copy of the sequence's repo with its dev dependency installed, committed, so a diff
// shows what the agent changed.
export function prepare(t: Ticket, work: string): void {
	rmSync(work, { recursive: true, force: true });
	mkdirSync(dirname(work), { recursive: true });
	cpSync(join(SEQ_DIR, t.seq, "repo"), work, { recursive: true });
	const pkg = join(work, "node_modules", "house-rules");
	mkdirSync(join(pkg, "dist"), { recursive: true });
	writeFileSync(join(pkg, "dist", "cli.min.mjs"), bundle(t.seq), { mode: 0o755 });
	writeFileSync(join(pkg, "package.json"), `${JSON.stringify({ name: "house-rules", version: "1.4.2", type: "module", bin: { "house-rules": "dist/cli.min.mjs" } }, null, 2)}\n`);
	mkdirSync(join(work, "node_modules", ".bin"), { recursive: true });
	symlinkSync("../house-rules/dist/cli.min.mjs", join(work, "node_modules", ".bin", "house-rules"));
	writeFileSync(join(work, ".gitignore"), "node_modules/\n");
	git(work, "init", "-q", "-b", "main");
	git(work, "add", "-A");
	git(work, "-c", "user.name=bench", "-c", "user.email=bench@invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base");
}

// The reference solution on top of a prepared repo: the ticket's new files, plus what the house
// rules and the issue want (registry entry, docs section, own test file and error codes for
// ledger; public API export and changelog line for dayplan). `skip` leaves one of them out.
export function applyRef(t: Ticket, work: string, skip: string[] = []): void {
	const ref = join(SEQ_DIR, t.seq, "tickets", t.name, "ref");
	cpSync(ref, work, { recursive: true });
	const files = (readdirSync(join(ref, "src"), { recursive: true }) as string[]).filter((f) => f.endsWith(".ts"));
	const edit = (p: string, fn: (s: string) => string) => writeFileSync(join(work, p), fn(readFileSync(join(work, p), "utf8")));
	for (const f of files) {
		const src = readFileSync(join(ref, "src", f), "utf8");
		const fns = [...src.matchAll(/export\s+function\s+(\w+)/g)].map((m) => m[1]);
		const mod = f.replace(/\.ts$/, "");
		if (t.seq === "ledger") {
			const name = mod.replace(/^ops\//, "");
			edit("src/registry.ts", (r) =>
				r.replace(/(export const OPERATIONS)/, `import { ${fns.join(", ")} } from "./${mod}.ts";\n\n$1`).replace(/\n};/, `\n${fns.map((n) => `\t${n},`).join("\n")}\n};`),
			);
			if (!skip.includes("docs")) edit("docs/operations.md", (d) => `${d}${fns.map((n) => `\n## ${n}\n\nSee src/${mod}.ts.\n`).join("")}`);
			if (!skip.includes("testfile")) {
				mkdirSync(join(work, "tests", "ops"), { recursive: true });
				writeFileSync(
					join(work, "tests", "ops", `${name}.spec.ts`),
					`import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { ${fns.join(", ")} } from "../../src/${mod}.ts";\n\ntest("${fns[0]} exists", () => {\n\tassert.equal(typeof ${fns[0]}, "function");\n});\n`,
				);
			}
			if (!skip.includes("codes")) {
				const codes = [...src.matchAll(/LedgerError\("([A-Z_]+)"/g)].map((m) => m[1]);
				edit("src/codes.ts", (c) => c.replace(/\];/, `${codes.map((x) => `, "${x}"`).join("")}];`));
			}
		}
		if (t.seq === "dayplan") {
			edit("src/index.ts", (i) => `${i}export * from "./${mod}.ts";\n`);
			if (!skip.includes("changelog")) edit("CHANGELOG.md", (c) => c.replace("## Unreleased\n", `## Unreleased\n\n- ${fns.map((n) => `\`${n}\``).join(", ")}: ${mod}.\n`));
		}
	}
}

export interface TestRun {
	ok: boolean;
	failed: string[]; // names of failed top-level tests
	output: string;
}

function run(cwd: string, args: string[], timeoutMs = 120_000) {
	const r = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: timeoutMs, env: { ...process.env, TZ: "UTC" } });
	return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function nodeTest(cwd: string, files: string[], timeoutMs = 120_000): TestRun {
	const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], { cwd, encoding: "utf8", timeout: timeoutMs, env: { ...process.env, TZ: "UTC" } });
	const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
	const failed = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
	return { ok: r.status === 0, failed, output };
}

// What `npm test` runs: the checker (pretest), then the repo's tests.
export function visible(work: string): TestRun {
	const rules = run(work, [join(work, "node_modules", "house-rules", "dist", "cli.min.mjs")]);
	const files = (readdirSync(join(work, "tests"), { recursive: true }) as string[]).filter((f) => f.endsWith(".spec.ts")).map((f) => join("tests", f));
	const tests = nodeTest(work, files);
	return { ok: rules.ok && tests.ok, failed: [...(rules.ok ? [] : ["house-rules"]), ...tests.failed], output: `${rules.output}\n${tests.output}` };
}

// Grading: the ticket's hidden tests plus the bench's own copy of the checker (so editing the
// installed one does not help). `rules` holds the checker's output.
export function hidden(t: Ticket, work: string): TestRun & { rules: string } {
	const dir = join(work, ".hidden");
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir);
	cpSync(join(SEQ_DIR, t.seq, "tickets", t.name, "hidden.spec.ts"), join(dir, "hidden.spec.ts"));
	const tests = nodeTest(work, [join(".hidden", "hidden.spec.ts")]);
	rmSync(dir, { recursive: true, force: true });
	const rules = run(work, [checker(t.seq)]);
	return { ok: tests.ok && rules.ok, failed: [...(rules.ok ? [] : ["house-rules"]), ...tests.failed], output: `${rules.output}\n${tests.output}`, rules: rules.output };
}

// Which of the ticket's traps the agent hit during the session (from its tool output) and which
// are still in the final tree (from the hidden tests).
export function trapsHit(t: Ticket, toolOutputs: string[], hiddenRun: TestRun & { rules: string }): { visible: string[]; hidden: string[] } {
	const vis: string[] = [];
	const hid: string[] = [];
	for (const trap of TRAPS[t.seq]) {
		if (!t.traps.includes(trap.name)) continue;
		if (toolOutputs.some((o) => trap.signature.test(o))) vis.push(trap.name);
		if (trap.signature.test(hiddenRun.rules) || (trap.hiddenTest && hiddenRun.failed.some((n) => trap.hiddenTest!.test(n)))) hid.push(trap.name);
	}
	return { visible: vis, hidden: hid };
}
