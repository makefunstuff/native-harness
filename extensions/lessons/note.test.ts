import assert from "node:assert/strict";
import { test } from "node:test";
import { FixTracker, commandKey, errorExcerpt, isCheck, isSearch } from "./detect.ts";
import { LIMITS, askMessage, expired, keepScore, lessonsMessage, makeNote, merge, noteId, parseReply, rankByText, similarity, tokens } from "./note.ts";

test("parseReply reads lesson blocks, continuation lines, confirms and contradicts", () => {
	const r = parseReply(
		[
			"Here it is:",
			"```lesson",
			"cue: adding a new operation module under src/ops",
			"lesson: list every exported function in src/registry.ts,",
			"  the conventions test fails otherwise",
			"evidence: tests/conventions.test.ts failed, passed after registering",
			"confidence: 0.85",
			"contradicts: L2",
			"```",
			"confirms: L1, lesson-abc",
		].join("\n"),
	);
	assert.equal(r.notes.length, 1);
	assert.equal(r.notes[0].cue, "adding a new operation module under src/ops");
	assert.match(r.notes[0].lesson, /registry\.ts, the conventions test fails otherwise$/);
	assert.equal(r.notes[0].confidence, 0.85);
	assert.deepEqual(r.contradicts, ["L2"]);
	assert.deepEqual(r.confirms, ["L1", "lesson-abc"]);
});

test("parseReply: no lesson, missing fields, bad confidence", () => {
	assert.deepEqual(parseReply("no lesson"), { notes: [], confirms: [], contradicts: [] });
	assert.equal(parseReply("```lesson\ncue: x\n```").notes.length, 0); // no lesson field
	assert.equal(parseReply("```lesson\ncue: x\nlesson: y\nconfidence: lots\n```").notes[0].confidence, 0.6);
	assert.equal(parseReply("```lesson\ncue: x\nlesson: y\nconfidence: 7\n```").notes[0].confidence, 1);
});

test("makeNote clips fields and derives a stable id from repo, cue words and lesson words", () => {
	const n = makeNote("r", { cue: "x ".repeat(300), lesson: "y".repeat(900), evidence: "z", confidence: 0.4 });
	assert.ok(n.cue.length <= LIMITS.cue && n.lesson.length <= LIMITS.lesson);
	assert.equal(noteId("r", "Rounding money amounts", "use roundHalfEven"), noteId("r", "money rounding  amount", "Use roundHalfEven."));
	assert.notEqual(noteId("r", "rounding", "x"), noteId("other", "rounding", "x"));
	assert.notEqual(noteId("r", "adding a new operation module", "give it tests/ops/<name>.spec.ts"), noteId("r", "adding a new operation module", "add a ## section to docs/operations.md"));
});

test("tokens split camelCase and drop stop words", () => {
	assert.deepEqual(tokens("Use roundHalfEven for the VAT amounts"), ["round", "half", "even", "vat", "amount"]);
});

test("rankByText puts the note whose cue the task covers first", () => {
	const a = makeNote("r", { cue: "rounding money amounts in an operation", lesson: "use roundHalfEven, not Math.round" });
	const b = makeNote("r", { cue: "dates and calendar days", lesson: "use UTC getters" });
	const ranked = rankByText("Add a VAT operation that returns the tax amount rounded to cents", [b, a]);
	assert.equal(ranked[0].note.id, a.id);
	assert.ok(ranked[0].score > ranked[1].score);
});

test("similarity: a similar cue with a different lesson is not the same note", () => {
	const codes = makeNote("r", { cue: "adding a new operation under src/ops", lesson: "list every new error code in src/codes.ts" });
	const tests = makeNote("r", { cue: "adding an operation in src/ops", lesson: "give the operation its own test file tests/ops/<name>.spec.ts" });
	assert.ok(similarity(codes, tests) < 0.6);
	const short = makeNote("r", { cue: "adding an operation", lesson: "tests/ops spec" });
	const long = makeNote("r", { cue: "adding an operation", lesson: "put the tests in tests/ops/<name>.spec.ts and document it in docs/operations.md and list its error codes" });
	assert.ok(similarity(short, long) < 0.6, "a short note is not merged into a longer one just by being contained in it");
});

test("similarity, merge, keepScore and expiry", () => {
	const a = makeNote("r", { cue: "new operation module", lesson: "register it in src/registry.ts", confidence: 0.6 });
	const b = makeNote("r", { cue: "adding an operation module", lesson: "register the functions in src/registry.ts", confidence: 0.7 });
	assert.ok(similarity(a, b) >= 0.6);
	const m = merge(a, b);
	assert.equal(m.id, a.id);
	assert.equal(m.hits, 2);
	assert.equal(m.confidence, 0.8);
	const old = { ...a, updated: new Date(Date.now() - 200 * 86_400_000).toISOString() };
	assert.ok(keepScore(old) < keepScore(a));
	assert.ok(expired(old, 180));
	assert.ok(!expired(old, 0));
});

test("messages name the shown lessons", () => {
	const n = makeNote("r", { cue: "rounding", lesson: "half even", evidence: "test failed" });
	assert.match(lessonsMessage([{ label: "L1", note: n }]), /L1\. When rounding: half even \(seen: test failed\)/);
	const ask = askMessage([{ failed: "npm test", error: "1 failing" }], [{ label: "L1", note: n }]);
	assert.match(ask, /`npm test` failed/);
	assert.match(ask, /contradicts: L…/);
	assert.doesNotMatch(askMessage([{ failed: "npm test", error: "x" }], []), /contradicts/);
});

test("commandKey strips cd, env, filters and redirections", () => {
	assert.equal(commandKey("cd /tmp/x && CI=1 npm test 2>&1 | tail -20"), "npm test");
	assert.equal(commandKey("timeout 60 node --test tests/"), "node --test tests/");
	assert.ok(isCheck("npx tsc --noEmit"));
	assert.ok(!isCheck("node scripts/gen.js"));
});

test("commandKey: chains are judged by their last check; heredoc bodies are ignored", () => {
	const write = "cd /w && cat > src/ops/x.ts <<'EOF'\nexport function f() { return a && b; } // test\nEOF\nnpm test && git status --short";
	assert.equal(commandKey(write), "npm test");
	assert.ok(isCheck(write));
	assert.ok(!isSearch(write), "cat > file is a write, not a search");
	assert.ok(isSearch("cd /w && cat a.ts; grep -n foo src | head"));
	assert.ok(isSearch("ls tests 2>&1"));
	assert.equal(commandKey("mkdir -p tests/ops && node gen.js"), "node gen.js");
});

test("errorExcerpt prefers assertion lines", () => {
	const out = "TAP version 13\nok 1 - a\nnot ok 2 - vat rounds\n  AssertionError: expected 13 to equal 12\n# pass 1\n# fail 1";
	assert.match(errorExcerpt(out), /not ok 2 - vat rounds \| AssertionError: expected 13 to equal 12/);
	const npm = "> pretest\n> house-rules\n\nhouse-rules: 1 problem\n  src/ops/x.ts has no test file tests/ops/x.spec.ts\nnpm error Lifecycle script `test` failed with error:\nnpm error code 1";
	assert.equal(errorExcerpt(npm), "house-rules: 1 problem | src/ops/x.ts has no test file tests/ops/x.spec.ts");
});

test("FixTracker pairs a failure with a later pass of the same command or any check", () => {
	const t = new FixTracker();
	t.onBash("grep -rn foo src", true, "", 1); // a search that found nothing is not a failure
	t.onBash("node gen.js", true, "Error: boom", 1);
	t.onBash("npm test", true, "not ok 1 - x\nAssertionError: 1 !== 2", 1);
	assert.equal(t.fixes.length, 0);
	assert.equal(t.failures, 2);
	t.onBash("cd /w && node --test tests/ 2>&1 | tail -5", false, "ok", 0); // another check passes
	assert.deepEqual(t.fixes.map((f) => f.failed), ["npm test"]);
	t.onBash("node gen.js", false, "done", 0); // same command passes
	assert.deepEqual(t.fixes.map((f) => f.failed), ["npm test", "node gen.js"]);
	const piped = new FixTracker();
	piped.onBash("npm test 2>&1 | tail -60", false, "> house-rules\nhouse-rules: 2 problems\n  CHANGELOG.md does not mention `f`", 0);
	piped.onBash("npm test 2>&1 | tail -60", false, "house-rules: ok\nℹ pass 4\nℹ fail 0", 0);
	assert.deepEqual(piped.fixes.map((f) => f.failed), ["npm test"], "a pipe hides the exit code; the output does not");
	const masked = new FixTracker();
	masked.onBash("npm test; echo $?", false, "ℹ fail 2\n1", 0);
	masked.onBash("npm test", false, "ℹ pass 4\nℹ fail 0", 0);
	assert.deepEqual(masked.fixes.map((f) => f.failed), ["npm test"], "a later command hides the exit code; the output does not");
	const clean = new FixTracker();
	clean.onBash("npm test && git status", false, "ℹ pass 4\nℹ fail 0", 0);
	assert.equal(clean.failures, 0);
	piped.onBash("npm test", false, "ℹ fail 1", 0);
	assert.equal(piped.failures, 1, "without a pipe the exit code is trusted");
	const commit = new FixTracker();
	commit.onBash("npx tsc --noEmit", true, "error TS2322: x", 2);
	commit.onBash("git commit -m 'fix test'", false, "", 0);
	commit.onBash('echo "build ok"', false, "build ok", 0);
	assert.equal(commit.fixes.length, 0, "a commit or an echo mentioning test/build is not a passing check");
	commit.onBash("npx tsc --noEmit", false, "", 0);
	assert.equal(commit.fixes.length, 1);
	t.onBash("npm test", true, "Command timed out after 60 seconds", 124);
	t.onBash("npm test", false, "ok", 0);
	assert.equal(t.fixes.length, 2, "a timeout is not a code failure");
});
