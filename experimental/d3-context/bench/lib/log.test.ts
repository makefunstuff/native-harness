import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { callsOf } from "../../../../bench/lib/session.ts";
import { d3LogPath, droppedPaths, parseD3Log, pathsOfLabel, refetchesOf, removedItems } from "./log.ts";

const lines = (xs: any[]) => xs.map((x) => JSON.stringify(x)).join("\n") + "\n";

const LOG = [
	{ t: 1, kind: "start", model: "vllm-d3-flash", contextWindow: 32768 },
	{ t: 2, kind: "request", messages: 4, payload_chars: 60000 },
	{ t: 3, kind: "check", turn: 5, boundary: 0.8, at_boundary: true, pressure: false, d3_ms: 400 },
	{ t: 4, kind: "decide", what: "boundary", ms: 120, usage: { input_tokens: 900, output_tokens: 1 } },
	{ t: 5, kind: "decide", what: "item", key: "call_a", label: "bash: cat ci/job-1.log", turn: 5, chars: 9000, ms: 300, usage: { input_tokens: 1200, output_tokens: 1 } },
	{ t: 6, kind: "decide", what: "item", key: "call_b", label: "read: notes.md", turn: 5, chars: 3000, ms: 280, usage: { input_tokens: 700, output_tokens: 1 } },
	{ t: 7, kind: "pin", key: "call_a", label: "bash: cat ci/job-1.log", ms: 40 },
	{
		t: 8,
		kind: "apply",
		turn: 5,
		reason: "boundary",
		items: [
			{ key: "call_a", label: "bash: cat ci/job-1.log", decision: "drop" },
			{ key: "call_b", label: "read: notes.md", decision: "summarize" },
			{ key: "call_c", label: "bash: ls", decision: "keep" },
		],
		saved_chars: 9000,
		d3_ms: 800,
		d3_calls: 3,
		wall_ms: 810,
	},
	{ t: 9, kind: "error", where: "check", error: "boom" },
];

function withLog(text: string, fn: (p: string) => void) {
	const dir = mkdtempSync(join(tmpdir(), "d3log-"));
	const p = join(dir, "ci-triage-r1.d3.jsonl");
	writeFileSync(p, text);
	try {
		fn(p);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("the router's own log: passes, calls, tokens, items, savings", () => {
	withLog(lines(LOG), (p) => {
		const log = parseD3Log(p);
		assert.equal(log.checks, 1);
		assert.equal(log.calls, 3, "one boundary decision and two item decisions");
		assert.deepEqual(log.callTokens, { in: 2800, out: 3 });
		assert.equal(log.d3Ms, 800, "the apply's own d3_ms");
		assert.equal(log.drops, 1);
		assert.equal(log.summaries, 1);
		assert.equal(log.kept, 1);
		assert.equal(log.savedChars, 9000);
		assert.equal(log.pins, 1);
		assert.deepEqual(log.errors, ["boom"]);
		assert.equal(log.start.model, "vllm-d3-flash");
	});
});

test("a missing log is an empty one, not a crash", () => {
	const log = parseD3Log("/nope/nothing.jsonl");
	assert.equal(log.checks, 0);
	assert.equal(log.calls, 0);
	assert.equal(droppedPaths("/nope/nothing.jsonl").size, 0);
	assert.equal(removedItems("/nope/nothing.jsonl").size, 0);
});

test("the files whose output was removed, and the ones that were kept out of it", () => {
	withLog(lines(LOG), (p) => {
		const paths = droppedPaths(p);
		assert.ok(paths.has("ci/job-1.log"), [...paths].join(","));
		assert.ok(paths.has("notes.md"));
		assert.ok(!paths.has("ls"));
		const items = removedItems(p);
		assert.deepEqual([...items.keys()], ["call_a", "call_b"], "a kept item is not a removal");
		assert.equal(items.get("call_a")!.decision, "drop");
		assert.equal(items.get("call_a")!.turn, 5);
	});
});

test("a refetch is a later call reading a removed file", () => {
	const entries = [
		{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call_a", name: "bash", arguments: { command: "cat ci/job-1.log" } }] } },
		{ type: "message", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "the log" }], isError: false } },
		{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call_x", name: "bash", arguments: { command: "grep -n fail ci/job-1.log" } }] } },
		{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call_y", name: "bash", arguments: { command: "cat README.md" } }] } },
	];
	const calls = callsOf(entries);
	assert.equal(calls.length, 3);
	withLog(lines(LOG), (p) => {
		const re = refetchesOf(calls, removedItems(p));
		assert.equal(re.n, 1, "the grep reads the removed log again; README.md is not a removal");
		assert.match(re.cases[0], /ci\/job-1\.log/);
	});
});

test("the paths of an item label", () => {
	assert.deepEqual([...pathsOfLabel("bash: cat ci/job-1.log && sed -n 1,5 ./notes.md")].sort(), ["ci/job-1.log", "notes.md"]);
});

test("the log of a run sits next to its rows, named by the arm", () => {
	assert.equal(d3LogPath("/tmp/raw/d3", "ci-triage", 2, "d3"), "/tmp/raw/d3/ci-triage-r2.d3.jsonl");
});
