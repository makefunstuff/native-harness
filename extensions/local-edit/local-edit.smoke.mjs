// Smoke test for local-edit in the installed package: the mock model writes a file, then edits it
// with a basename path and the wrong indentation (pi's own edit would fail), then misses on purpose.
// The tool results must show the tolerant match with its diff, and the closest lines on the miss.
import assert from "node:assert/strict";
import { MOCK_MODEL, textOf } from "../../test/lib/harness.mjs";

const FILE = "def total(xs):\n    s = 0\n    for x in xs:\n        s += x\n    return s\n";

export default {
	name: "local-edit: tolerant edit with diff, candidates on a miss",
	prompt: "fix the file",
	respond(body, n) {
		const results = body.messages.filter((m) => m.role === "tool").map(textOf);
		if (n === 0) {
			assert.ok(body.tools?.some((t) => t.function?.name === "edit"), "edit offered to the model");
			return { toolCalls: [{ name: "write", arguments: { path: "pkg/calc.py", content: FILE } }] };
		}
		if (n === 1)
			return { toolCalls: [{ name: "edit", arguments: { path: "calc.py", edits: [{ oldText: "for x in xs:\n    s += x", newText: "for x in xs:\n    s += x * 2" }] } }] };
		if (n === 2) {
			assert.match(results.at(-1), /Successfully replaced 1 block/);
			return { toolCalls: [{ name: "edit", arguments: { path: "pkg/calc.py", edits: [{ oldText: "    return sum(xs)", newText: "    return 0" }] } }] };
		}
		return { content: `RESULTS<<${results.join("\n----\n")}>>` };
	},
	check({ stdout }) {
		assert.match(stdout, /path "calc\.py" resolved to "pkg\/calc\.py"/);
		assert.match(stdout, /matched lines 3-4 \(indentation ignored\)/);
		assert.match(stdout, /-4\s+ {8}s \+= x\n\+4\s+ {8}s \+= x \* 2/);
		assert.match(stdout, /Closest text in the file:\nline 5 \(\d+% similar\):\n5\|     return s/);
	},
	model: MOCK_MODEL,
};
