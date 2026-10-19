// verify-gate end to end in pi -p: the mock model writes a file and claims it is done; the
// project's .pi/verify fails, so pi sends the check output back as one more user message (appended:
// the next request starts with the previous one); the model fixes it through bash and the run ends.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MOCK_MODEL, textOf } from "../../test/lib/harness.mjs";

const RULE = "Tests must not share assumptions with the code under test";
const sys = (body) => body.messages.filter((m) => m.role === "system").map(textOf).join("\n");

export default {
	name: "verify-gate: failing check sends the model back, once fixed the run ends",
	prompt: "Add notes.txt and make the check pass.",
	cwd() {
		const d = mkdtempSync(join(process.env.PI_EXTRAS_TMP ?? tmpdir(), "verify-gate-smoke-"));
		execFileSync("git", ["-C", d, "init", "-q"]);
		mkdirSync(join(d, ".pi"));
		writeFileSync(join(d, ".pi", "verify"), 'test -f fixed || { echo "FAIL: fixed is missing"; exit 1; }\n');
		return d;
	},
	respond(body, n) {
		assert.ok(sys(body).includes(RULE), "test rule in the system prompt");
		if (n === 0) return { toolCalls: [{ name: "write", arguments: { path: "notes.txt", content: "notes\n" } }] };
		if (n === 1) return { content: "All done, make test passes." };
		if (n === 2) {
			const last = body.messages.at(-1);
			assert.equal(last.role, "user");
			assert.match(textOf(last), /verify-gate: the project's check fails/);
			assert.match(textOf(last), /FAIL: fixed is missing/);
			return { toolCalls: [{ name: "bash", arguments: { command: "touch fixed" } }] };
		}
		return { content: "Fixed for real: VERIFIED" };
	},
	check({ stdout }, mock, cwd) {
		assert.equal(mock.requests.length, 4, "one extra round, then the check passes and pi stops");
		const [, r1, r2] = mock.requests;
		assert.deepEqual(r2.messages.slice(0, r1.messages.length), r1.messages, "history is appended to, never rewritten");
		assert.match(stdout, /VERIFIED/);
		assert.ok(existsSync(join(cwd, "fixed")));
	},
	model: MOCK_MODEL,
};
