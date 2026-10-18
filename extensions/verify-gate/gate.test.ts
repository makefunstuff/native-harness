import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { failureMessage, findCheck, parseAgentsMd, runCheck, treeFingerprint, truncate } from "./gate.ts";

const dirs: string[] = [];
function tmp(): string {
	const d = mkdtempSync(join(process.env.PI_EXTRAS_TMP ?? tmpdir(), "verify-gate-test-"));
	dirs.push(d);
	return d;
}
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

test("parseAgentsMd: comment form", () => {
	assert.equal(parseAgentsMd("intro\n<!-- verify: make test -->\n"), "make test");
});

test("parseAgentsMd: Verify:/Check: line forms", () => {
	assert.equal(parseAgentsMd("Verify: `npm test`"), "npm test");
	assert.equal(parseAgentsMd("- **Check command:** `scripts/check.sh --fast`"), "scripts/check.sh --fast");
	assert.equal(parseAgentsMd("* check: `cargo test`"), "cargo test");
});

test("parseAgentsMd: first fenced block under a Verify/Checks heading", () => {
	const md = "# Proj\n\n## Checks\n\nRun these:\n\n```sh\nmake lint\nmake test\n```\n\n```sh\nnot this\n```\n";
	assert.equal(parseAgentsMd(md), "make lint\nmake test");
});

test("parseAgentsMd: a block in a later section does not count", () => {
	const md = "## Checks\n\n- `./gradlew test`: core\n\n## UI\n\n```sh\n./gradlew render\n```\n";
	assert.equal(parseAgentsMd(md), undefined);
});

test("parseAgentsMd: prose mentioning tests is ignored", () => {
	assert.equal(parseAgentsMd("Run the checks listed in README.md before pushing. Tests: `swift test` maybe"), undefined);
});

test("findCheck: .pi/verify beats AGENTS.md; search stops at the git root", () => {
	const root = tmp();
	mkdirSync(join(root, ".git"));
	mkdirSync(join(root, "sub", "deep"), { recursive: true });
	writeFileSync(join(root, "AGENTS.md"), "Verify: `make test`\n");
	assert.deepEqual(findCheck(join(root, "sub", "deep")), { script: "make test", source: "AGENTS.md", root, label: "make test" });
	mkdirSync(join(root, ".pi"));
	writeFileSync(join(root, ".pi", "verify"), "# comment\npython3 -m unittest\n");
	const c = findCheck(join(root, "sub"))!;
	assert.equal(c.source, ".pi/verify");
	assert.equal(c.label, "python3 -m unittest");
	// a parent of the git root is not searched
	const outer = tmp();
	writeFileSync(join(outer, "AGENTS.md"), "Verify: `outer`\n");
	mkdirSync(join(outer, "repo", ".git"), { recursive: true });
	assert.equal(findCheck(join(outer, "repo")), undefined);
});

test("findCheck: executable .pi/verify is run directly", async () => {
	const root = tmp();
	mkdirSync(join(root, ".git"));
	mkdirSync(join(root, ".pi"));
	const f = join(root, ".pi", "verify");
	writeFileSync(f, "#!/bin/sh\necho from-script $PWD\nexit 3\n");
	chmodSync(f, 0o755);
	const c = findCheck(root)!;
	assert.equal(c.file, f);
	const res = await runCheck(c);
	assert.equal(res.ok, false);
	assert.equal(res.code, 3);
	assert.match(res.output, new RegExp(`from-script ${root}`));
});

test("runCheck: pass, fail with combined output, timeout kills the group", async () => {
	const root = tmp();
	const ok = await runCheck({ script: "echo fine", source: "x", root, label: "x" });
	assert.equal(ok.ok, true);
	const bad = await runCheck({ script: "echo out; echo err >&2; exit 1", source: "x", root, label: "x" });
	assert.equal(bad.ok, false);
	assert.match(bad.output, /out\n/);
	assert.match(bad.output, /err\n/);
	const slow = await runCheck({ script: "sleep 30 & sleep 30", source: "x", root, label: "x" }, { timeoutMs: 300 });
	assert.equal(slow.timedOut, true);
	assert.equal(slow.ok, false);
	assert.ok(slow.ms < 5000);
});

test("truncate keeps head and tail", () => {
	const s = "A".repeat(1000) + "B".repeat(5000) + "Z".repeat(1000);
	const t = truncate(s, 2000);
	assert.ok(t.length < 2100);
	assert.ok(t.startsWith("A"));
	assert.ok(t.endsWith("Z".repeat(1000)));
	assert.match(t, /characters cut/);
	assert.equal(truncate("short", 2000), "short");
});

test("treeFingerprint changes on edits and new files, not on caches", () => {
	const root = tmp();
	const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
	git("init", "-q");
	writeFileSync(join(root, "a.py"), "x = 1\n");
	git("add", "-A");
	git("-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm", "init");
	const f0 = treeFingerprint(root);
	assert.ok(f0);
	mkdirSync(join(root, "__pycache__"));
	writeFileSync(join(root, "__pycache__", "a.cpython-313.pyc"), "bytes");
	assert.equal(treeFingerprint(root), f0, "pycache ignored");
	writeFileSync(join(root, "b.py"), "new\n");
	const f1 = treeFingerprint(root);
	assert.notEqual(f1, f0);
	writeFileSync(join(root, "a.py"), "x = 2\n");
	assert.notEqual(treeFingerprint(root), f1);
	assert.equal(treeFingerprint(tmp()), undefined, "no git repository");
});

test("failureMessage names the command, the round and the output", () => {
	const m = failureMessage({ script: "make test", source: ".pi/verify", root: "/", label: "make test" }, { ok: false, code: 2, signal: null, timedOut: false, ms: 1234, output: "FAILED test_x\n" }, 1, 2);
	assert.match(m, /round 1 of 2/);
	assert.match(m, /`make test` \(from \.pi\/verify\), exit code 2, 1\.2 s/);
	assert.match(m, /FAILED test_x/);
	assert.match(m, /Do not weaken/);
});
