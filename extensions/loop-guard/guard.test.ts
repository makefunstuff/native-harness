import assert from "node:assert/strict";
import { test } from "node:test";
import { callKey, LoopGuard, outcomeKey, parseOptions, stallIntent } from "./guard.ts";

test("callKey ignores key order, command whitespace and bash output plumbing", () => {
	assert.equal(callKey("edit", { path: "a.py", oldText: "x = 1" }), callKey("edit", { oldText: "x = 1", path: "a.py" }));
	assert.notEqual(callKey("edit", { path: "a.py", oldText: "foo" }), callKey("edit", { path: "a.py", oldText: "foo " }));
	assert.equal(callKey("bash", { command: "ls  -la\n src" }), callKey("bash", { command: "ls -la src" }));
	assert.equal(callKey("bash", { command: "pytest -q" }), callKey("bash", { command: "pytest  -q 2>&1 | tail -20" }));
	assert.equal(callKey("bash", { command: "pytest -q 2>&1 | head -n 40" }), callKey("bash", { command: "pytest -q" }));
	assert.notEqual(callKey("bash", { command: "pytest -q" }), callKey("bash", { command: "pytest -q tests/a.py" }));
	assert.notEqual(callKey("read", { path: "a" }), callKey("edit", { path: "a" }));
});

test("outcomeKey ignores numbers and whitespace", () => {
	assert.equal(outcomeKey("1 failed in 0.31s\n"), outcomeKey("1 failed in 0.29s"));
	assert.notEqual(outcomeKey("NameError: foo"), outcomeKey("NameError: bar"));
});

test("retry: an identical failing call that fails the same way gets a note", () => {
	const g = new LoopGuard();
	const args = { path: "a.py", oldText: "x = 1", newText: "x = 2" };
	assert.equal(g.onResult("edit", args, "Could not find the exact text in a.py", true), undefined);
	const n = g.onResult("edit", args, "Could not find the exact text in a.py", true);
	assert.equal(n?.rule, "retry");
	assert.match(n!.text, /^\[loop-guard\] This exact `edit` call has now failed 2 times/);
	assert.match(n!.text, /previous call was this same call/);
	assert.match(n!.text, /read the file again/);
	assert.equal(g.fired.retry, 1);
});

test("retry: a call between the attempts changes the wording", () => {
	const g = new LoopGuard();
	g.onResult("bash", { command: "python t.py" }, "NameError: foo\nexit 1", true);
	g.onResult("edit", { path: "t.py", oldText: "a", newText: "b" }, "ok", false);
	const n = g.onResult("bash", { command: "python t.py" }, "NameError: foo\nexit 1", true);
	assert.equal(n?.rule, "retry");
	assert.match(n!.text, /did not change this error/);
});

test("retry: no note when the retry succeeds or fails differently", () => {
	const g = new LoopGuard();
	g.onResult("bash", { command: "make" }, "error: x", true);
	assert.equal(g.onResult("bash", { command: "make" }, "built", false), undefined);
	g.onResult("bash", { command: "make test" }, "error: x", true);
	assert.equal(g.onResult("bash", { command: "make test" }, "error: y", true), undefined);
});

test("repeat: identical successful calls with identical output at 3, 5 and 8", () => {
	const g = new LoopGuard();
	const fired: number[] = [];
	for (let i = 1; i <= 8; i++) if (g.onResult("read", { path: "a.py" }, "same", false)) fired.push(i);
	assert.deepEqual(fired, [3, 5, 8]);
	assert.equal(g.fired.repeat, 3);
});

test("repeat: no note when the output changed", () => {
	const g = new LoopGuard();
	g.onResult("bash", { command: "git status" }, "clean", false);
	g.onResult("bash", { command: "git status" }, "modified: a", false);
	assert.equal(g.onResult("bash", { command: "git status" }, "modified: a", false), undefined);
});

test("streak: three different failing calls in a row", () => {
	const g = new LoopGuard();
	assert.equal(g.onResult("read", { path: "a" }, "ENOENT a", true), undefined);
	assert.equal(g.onResult("read", { path: "b" }, "ENOENT b", true), undefined);
	const n = g.onResult("read", { path: "c" }, "ENOENT c", true);
	assert.equal(n?.rule, "streak");
	assert.match(n!.text, /last 3 tool calls all failed/);
	g.onResult("ls", {}, "ok", false);
	assert.equal(g.onResult("read", { path: "d" }, "ENOENT d", true), undefined);
});

test("window: calls older than the window are forgotten", () => {
	const g = new LoopGuard({ ...parseOptions(""), window: 3 });
	g.onResult("bash", { command: "x" }, "boom", true);
	for (let i = 0; i < 3; i++) g.onResult("read", { path: `f${i}` }, "ok", false);
	assert.equal(g.onResult("bash", { command: "x" }, "boom", true), undefined);
});

test("PI_LOOP_GUARD turns rules off", () => {
	assert.equal(parseOptions("off").disabled.size, 4);
	assert.deepEqual([...parseOptions("-stall, -repeat").disabled].sort(), ["repeat", "stall"]);
	const g = new LoopGuard(parseOptions("-retry"));
	g.onResult("bash", { command: "x" }, "boom", true);
	assert.equal(g.onResult("bash", { command: "x" }, "boom", true), undefined);
});

test("stallIntent: catches announced actions", () => {
	for (const t of [
		"The parser is wrong. I'll fix the boundary check now.",
		"Now let me run the tests:",
		"Let me update the README.",
		"I need to add the migration as well.",
		"Found it.\n\nNext, I'll edit `cli.py` to add the flag…",
		"**Let me check the config file.**",
		"Let me check if the tests pass.",
		"Let me fix the test that isn't passing.",
		"I'll fix the bug once and for all.",
		"Now I need to update the tests until they pass.",
		"Let me look at when the timeout fires.",
		"I'll keep going with the refactor.",
	])
		assert.ok(stallIntent(t), t);
	assert.equal(stallIntent("Done. Now let me run the tests:"), "let me run the tests");
});

test("stallIntent: leaves finished answers and questions alone", () => {
	for (const t of [
		"All tests pass. The change is in cli.py.",
		"Let me know if you want the old flag kept.",
		"I'll stop here; everything passes.",
		"Should I also update the docs?",
		"If you'd like, I can add more tests.",
		"Summary:\n- fixed the parser\n- added tests",
		"",
		"I fixed it. The tests I'll mention below all pass and there is a long tail on this sentence to push it far away.",
	])
		assert.equal(stallIntent(t), undefined, t);
});

test("onFinal: at most two nudges per prompt", () => {
	const g = new LoopGuard();
	assert.equal(g.onFinal("I'll run the tests.")?.rule, "stall");
	assert.ok(g.onFinal("I'll run the tests."));
	assert.equal(g.onFinal("I'll run the tests."), undefined);
	g.newPrompt();
	assert.ok(g.onFinal("Let me run the tests."));
	assert.match(g.onFinal("Let me check.")!.text, /ends with "Let me check" but you made no tool call/);
});

test("stallIntent: waiting, conditions, negations and questions are not stalls", () => {
	for (const t of [
		"The run is going. I'll report back when it finishes.",
		"I'll run the final verification when bg_11 lands.",
		"Which OS — X11 or Win32? I'll write it after.",
		"I should not start that silently because it launches services.",
		"Say go, or pick numbers. I'll build them once that agent finishes.",
		"And I will not touch your relaunched app.",
		"I'll watch the next update.",
		"I'll keep you posted.",
		"I'll comment if that pattern appears.",
		"I'll review the final guide for completeness when it's delivered.",
		"The build is running; I'll check the logs after it finishes.",
		"Fixed the bug. I should note that the old API is deprecated.",
		"All tests pass. Let's recap: the change renames foo.",
		"Done. I need to mention that you must restart the server.",
		"Everything is in place.\n\nNext, I recommend running the full suite yourself.",
		"Summary done. I'll also note that X is slow.",
	])
		assert.equal(stallIntent(t), undefined, t);
});
