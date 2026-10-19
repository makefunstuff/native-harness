import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fakeCtx, fakePi } from "../../test/lib/fake-pi.ts";
import { TEST_RULE } from "./gate.ts";
import extension, { readConfig, verifyGate } from "./index.ts";

const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// A git repo whose .pi/verify passes once the file "fixed" exists.
function project(): string {
	const d = mkdtempSync(join(process.env.PI_EXTRAS_TMP ?? tmpdir(), "verify-gate-ext-"));
	dirs.push(d);
	execFileSync("git", ["-C", d, "init", "-q"]);
	mkdirSync(join(d, ".pi"));
	writeFileSync(join(d, ".pi", "verify"), 'test -f fixed || { echo "FAIL: fixed is missing"; exit 1; }\n');
	return d;
}

function settle(entries: any[] = [], outcome = "completed", cont = false) {
	return { type: "agent_before_settle", entries, continue: cont, outcome, context: { canContinue: false } };
}

const userStart = () => ({ type: "before_agent_start", messageType: "user", prompt: "p", systemPromptOptions: { promptGuidelines: [] as string[] } });
const config = { gate: true, rule: true, rounds: 2, timeoutMs: 10_000, maxOutput: 4000 };

test("readConfig modes", () => {
	assert.deepEqual([readConfig({}).gate, readConfig({}).rule], [true, true]);
	assert.deepEqual([readConfig({ PI_VERIFY_GATE: "off" }).gate, readConfig({ PI_VERIFY_GATE: "off" }).rule], [false, false]);
	assert.deepEqual([readConfig({ PI_VERIFY_GATE: "rule-only" }).gate, readConfig({ PI_VERIFY_GATE: "rule-only" }).rule], [false, true]);
	assert.deepEqual([readConfig({ PI_VERIFY_GATE: "gate-only" }).gate, readConfig({ PI_VERIFY_GATE: "gate-only" }).rule], [true, false]);
	assert.equal(readConfig({ PI_VERIFY_ROUNDS: "5", PI_VERIFY_TIMEOUT: "7" }).rounds, 5);
	assert.equal(readConfig({ PI_VERIFY_TIMEOUT: "7" }).timeoutMs, 7000);
});

test("adds the test rule once, as a guideline (no system prompt replacement)", async () => {
	const pi = fakePi();
	extension(pi as any);
	const ev = userStart();
	const ctx = fakeCtx({ cwd: project() });
	await pi.emit("before_agent_start", ev, ctx);
	await pi.emit("before_agent_start", ev, ctx);
	assert.deepEqual(ev.systemPromptOptions.promptGuidelines, [TEST_RULE]);
	assert.ok(pi.commands.get("verify"), "/verify registered");
});

test("no edits: no check, no continuation", async () => {
	const pi = fakePi();
	verifyGate(pi as any, config);
	const ctx = fakeCtx({ cwd: project(), isProjectTrusted: () => true });
	await pi.emit("before_agent_start", userStart(), ctx);
	const [r] = await pi.emit("agent_before_settle", settle(), ctx);
	assert.equal(r, undefined);
});

test("failing check after an edit: continue with the output, then pass", async () => {
	const pi = fakePi();
	verifyGate(pi as any, config);
	const cwd = project();
	const ctx = fakeCtx({ cwd, isProjectTrusted: () => true });
	await pi.emit("before_agent_start", userStart(), ctx);
	await pi.emit("tool_result", { toolName: "write", isError: false }, ctx);
	const prior = { type: "custom", customType: "other" };
	const [r1] = await pi.emit("agent_before_settle", settle([prior]), ctx);
	assert.equal(r1.continue, true);
	assert.equal(r1.entries[0], prior, "keeps entries of earlier handlers");
	const msg = r1.entries.find((e: any) => e.type === "custom_message");
	assert.match(msg.content, /round 1 of 2/);
	assert.match(msg.content, /FAIL: fixed is missing/);
	// the model fixes it, through bash (no edit tool): the tree fingerprint notices
	writeFileSync(join(cwd, "fixed"), "");
	const [r2] = await pi.emit("agent_before_settle", settle(), ctx);
	assert.equal(r2.continue, undefined);
	assert.equal(r2.entries.length, 1);
	assert.equal(r2.entries[0].type, "custom");
	assert.equal(r2.entries[0].data.ok, true);
	assert.equal(r2.entries[0].data.round, 1);
});

test("at most `rounds` continuations, then a visible give-up note", async () => {
	const pi = fakePi();
	verifyGate(pi as any, config);
	const ctx = fakeCtx({ cwd: project(), isProjectTrusted: () => true });
	await pi.emit("before_agent_start", userStart(), ctx);
	const results = [];
	for (let i = 0; i < 3; i++) {
		await pi.emit("tool_result", { toolName: "edit", isError: false }, ctx);
		results.push((await pi.emit("agent_before_settle", settle(), ctx))[0]);
	}
	assert.deepEqual(results.map((r) => r.continue), [true, true, undefined]);
	assert.match(results[2].entries.at(-1).content, /still fails after 2 rounds/);
	assert.ok(ctx.notes.some((n: any) => n.level === "warning"));
	// a new user prompt starts the count again
	await pi.emit("before_agent_start", userStart(), ctx);
	await pi.emit("tool_result", { toolName: "edit", isError: false }, ctx);
	const [r] = await pi.emit("agent_before_settle", settle(), ctx);
	assert.equal(r.continue, true);
});

test("skips aborted runs, failed edits, other continuations and untrusted projects", async () => {
	const pi = fakePi();
	verifyGate(pi as any, config);
	const cwd = project();
	let trusted = true;
	const ctx = fakeCtx({ cwd, isProjectTrusted: () => trusted });
	await pi.emit("before_agent_start", userStart(), ctx);
	await pi.emit("tool_result", { toolName: "edit", isError: true }, ctx);
	assert.equal((await pi.emit("agent_before_settle", settle(), ctx))[0], undefined, "failed edit changes nothing");
	await pi.emit("tool_result", { toolName: "edit", isError: false }, ctx);
	assert.equal((await pi.emit("agent_before_settle", settle([], "aborted"), ctx))[0], undefined);
	assert.equal((await pi.emit("agent_before_settle", settle([], "completed", true), ctx))[0], undefined);
	trusted = false;
	assert.equal((await pi.emit("agent_before_settle", settle(), ctx))[0], undefined);
	assert.match(ctx.notes[0].message, /untrusted/);
	trusted = true;
	assert.equal((await pi.emit("agent_before_settle", settle(), ctx))[0].continue, true, "the edit is still pending");
});

test("PI_VERIFY_GATE=rule-only: rule, no gate", async () => {
	const pi = fakePi();
	verifyGate(pi as any, { ...config, gate: false });
	assert.equal(pi.handlers.get("agent_before_settle"), undefined);
	assert.equal(pi.handlers.get("before_agent_start")?.length, 1);
});

test("/verify does not run the check in an untrusted project", async () => {
	const pi = fakePi();
	verifyGate(pi as any, config);
	const cwd = project();
	writeFileSync(join(cwd, ".pi", "verify"), "touch ran\n");
	const ctx = fakeCtx({ cwd, isProjectTrusted: () => false });
	await pi.commands.get("verify").handler("", ctx);
	assert.match(ctx.notes[0].message, /untrusted/);
	assert.equal(existsSync(join(cwd, "ran")), false);
	const trusted = fakeCtx({ cwd, isProjectTrusted: () => true });
	await pi.commands.get("verify").handler("", trusted);
	assert.equal(existsSync(join(cwd, "ran")), true);
});
