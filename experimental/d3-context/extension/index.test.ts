import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakePi } from "../../../test/lib/fake-pi.ts";

const tmp = mkdtempSync(join(tmpdir(), "d3-context-test-"));
process.env.D3_URL = "http://d3.test/v1";
process.env.D3_LOG = join(tmp, "d3.jsonl");
const { default: extension } = await import("./index.ts");

// fake System One server: the boundary probability is set per test, every item is "drop", every pin kept
let boundary = 0.1;
globalThis.fetch = (async (_url: string, init: any) => {
	const qs = JSON.parse(init.body).questions;
	const answers: Record<string, any> = {};
	for (const k of Object.keys(qs)) {
		if (k === "boundary") answers[k] = { type: "noul", noul: boundary };
		else if (k === "item") answers[k] = { type: "choice", choice: "drop", probabilities: { keep: 0.1, summarise: 0.1, drop: 0.8 } };
		else answers[k] = { type: "noul", noul: 0.9 };
	}
	return new Response(JSON.stringify({ answers, usage: {} }), { status: 200 });
}) as any;

const X = 58000; // chars per tool output: 5 raw outputs are > 80k tokens, 4 are < 80k
function transcript(nTurns: number) {
	const m: any[] = [{ role: "user", content: "Fix the bugs.", timestamp: 0 }];
	for (let k = 1; k <= nTurns; k++) {
		m.push({ role: "assistant", timestamp: k, content: [{ type: "toolCall", id: `c${k}`, name: "bash", arguments: { command: `cat f${k}.txt` } }] });
		const text = `Error: bad value in f${k}.py line 3\n` + "x".repeat(X);
		m.push({ role: "toolResult", toolCallId: `c${k}`, toolName: "bash", content: [{ type: "text", text }] });
	}
	return m;
}
const settle = () => new Promise((r) => setTimeout(r, 50)); // checks run in the background
const logged = (kind: string) =>
	readFileSync(process.env.D3_LOG!, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.kind === kind);

test("pressure is measured on the edited request, and the notes block rides on the newest message", async () => {
	const pi = fakePi();
	extension(pi as any);
	const ctx = (n: number) => pi.emit("context", { type: "context", messages: transcript(n) });

	boundary = 0.9; // turn 3: at a boundary, turn 1's output is dropped
	await ctx(3);
	await settle();
	assert.equal(logged("apply").length, 1);
	assert.equal(logged("apply")[0].reason, "boundary");

	boundary = 0.1; // turn 5: no boundary; raw history ~89k tokens, the request as sent ~72k
	const [r5] = await ctx(5);
	await settle();
	const c5 = logged("check").at(-1);
	assert.equal(c5.turn, 5);
	assert.ok(c5.est_tokens < 80000, `estimate ${c5.est_tokens} must exclude the dropped output`);
	assert.equal(c5.pressure, false);
	assert.equal(logged("apply").length, 1, "no edit without a boundary or real pressure");

	// the dropped output is a stub, its pinned line is in one notes block on the last message
	const stub = r5.messages.find((m: any) => m.toolCallId === "c1");
	assert.match(stub.content[0].text, /removed from the context/);
	assert.doesNotMatch(stub.content[0].text, /bad value/);
	const last = r5.messages.at(-1);
	const notes = last.content.map((b: any) => b.text).join("\n");
	assert.match(notes, /Pinned notes/);
	assert.match(notes, /bad value in f1\.py line 3/);
	assert.equal(r5.messages.filter((m: any) => JSON.stringify(m.content).includes("Pinned notes")).length, 1);

	await ctx(7); // the request as sent is now ~105k tokens: the fallback applies
	await settle();
	assert.equal(logged("check").at(-1).pressure, true);
	assert.equal(logged("apply").at(-1).reason, "pressure");
});
