// Smoke test for loop-guard in a real pi process: the mock model retries a failing read unchanged,
// then stops on "I'll …" without a tool call. The second read's result must carry the note, and
// pi must send one more request with the stall nudge as the last message.
import assert from "node:assert/strict";
import { MOCK_MODEL, textOf } from "../../test/lib/harness.mjs";

const READ = { name: "read", arguments: { path: "missing-file.txt" } };

export default {
	name: "blind retry note and stall nudge",
	prompt: "Show me missing-file.txt",
	respond(body, n) {
		const last = body.messages.at(-1);
		if (n === 0 || n === 1) return { toolCalls: [READ] };
		if (n === 2) {
			const results = body.messages.filter((m) => m.role === "tool").map(textOf);
			assert.equal(results.length, 2);
			assert.doesNotMatch(results[0], /loop-guard/, "first failure has no note");
			assert.match(results[1], /\[loop-guard\] This exact `read` call has now failed 2 times/);
			return { content: "The file does not exist. I'll create it now." };
		}
		if (n === 3) {
			assert.equal(last.role, "user");
			assert.match(textOf(last), /\[loop-guard\] Your last message ends with "I'll create it now" but you made no tool call/);
			// the earlier messages are unchanged: the nudge is appended after the assistant's answer
			assert.equal(textOf(body.messages.at(-2)), "The file does not exist. I'll create it now.");
			return { content: "LOOP_GUARD_DONE: the file does not exist and nothing else was asked." };
		}
		throw new Error(`unexpected request ${n}`);
	},
	check({ stdout }, mock) {
		assert.match(stdout, /LOOP_GUARD_DONE/);
		assert.equal(mock.requests.length, 4);
	},
	model: MOCK_MODEL,
};
