// thinking-guard end to end, on pi -p against the mock model (loopback, so a "local" model):
//   1. a reply that thinks past the limit is aborted and the request issued again with the note
//      appended; the second request is the first one plus the note (append-only history);
//   2. a server that answers /props like llama.cpp gets the thinking budget in the request.
import assert from "node:assert/strict";
import { MOCK_MODEL, textOf } from "../../test/lib/harness.mjs";

const env = { PI_THINKING_GUARD_CONFIG: "/nonexistent/thinking-guard.json" }; // defaults, whatever the copied config has
const mockModel = { reasoning: true, compat: { supportsDeveloperRole: false } };

export default [
	{
		name: "runaway thinking: abort, then re-issue with the note appended",
		prompt: "Fix the bug.",
		model: `${MOCK_MODEL}:low`,
		mockModel,
		env,
		respond(body, n) {
			if (n === 0) return { reasoning: "Let me think about this very carefully. ".repeat(1000), reasoningChunk: 500, delayMs: 5, content: "never reached" };
			return { content: "GUARD_OK acted" };
		},
		check({ stdout }, mock) {
			assert.match(stdout, /GUARD_OK/);
			assert.deepEqual(mock.aborted, [0], "first reply aborted mid-thinking");
			assert.equal(mock.requests.length, 2);
			const [first, second] = mock.requests.map((r) => r.messages);
			assert.equal(first.at(-1).role, "user");
			assert.deepEqual(second.slice(0, first.length), first, "second request starts with the first one");
			assert.equal(second.length, first.length + 1, "exactly one message appended");
			assert.equal(second.at(-1).role, "user");
			assert.match(textOf(second.at(-1)), /\[thinking-guard\] .*stopped after \d+ characters of thinking/);
			assert.equal(mock.requests[0].thinking_budget_tokens, undefined, "no budget: not a llama.cpp server");
		},
	},
	{
		name: "llama.cpp server: thinking budget sent with the request",
		prompt: "Say ok.",
		model: `${MOCK_MODEL}:low`,
		mockModel,
		env,
		mock: { props: { role: "router", build_info: "b0-mock" } },
		respond: () => ({ reasoning: "Short thought.", content: "BUDGET_OK" }),
		check({ stdout }, mock) {
			assert.match(stdout, /BUDGET_OK/);
			assert.equal(mock.requests[0].thinking_budget_tokens, 3000);
			assert.match(mock.requests[0].reasoning_budget_message, /stop thinking now and act/);
		},
	},
];
