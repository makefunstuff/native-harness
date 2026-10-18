// Smoke test for the template: pi calls template_shout through the mock model and the result
// comes back in the next request. Copy and adapt for a real extension.
import assert from "node:assert/strict";
import { join } from "node:path";
import { MOCK_MODEL, REPO, textOf } from "../../test/lib/harness.mjs";

export default {
	name: "template extension: tool round trip",
	// extra pi arguments: the template is not in the package manifest, so load it explicitly
	args: ["-e", join(REPO, "templates/extension/index.ts")],
	prompt: "shout ok",
	respond(body, n) {
		if (n === 0) {
			assert.ok(body.tools?.some((t) => t.function?.name === "template_shout"), "template_shout offered to the model");
			return { toolCalls: [{ name: "template_shout", arguments: { text: "ok" } }] };
		}
		const result = body.messages.filter((m) => m.role === "tool").map(textOf).join("\n");
		return { content: `tool said ${result}` };
	},
	check({ stdout }) {
		assert.match(stdout, /tool said OK/);
	},
	model: MOCK_MODEL,
	// optional: mockModel overrides the mock's models.json entry (e.g. { reasoning: true }), mock passes
	// options to startMockModel (e.g. { props } to answer /props like llama.cpp), env adds variables,
	// and respond() may return { reasoning } to stream reasoning_content (see test/lib/harness.mjs)
};
