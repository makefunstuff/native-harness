import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeCtx, fakePi } from "../../test/lib/fake-pi.ts";
import extension, { CUSTOM_TYPE } from "./index.ts";

const assistant = (content: any[], stopReason = "toolUse") => ({ role: "assistant", content, stopReason });
const call = (id: string, name: string, args: any) => ({ type: "toolCall", id, name, arguments: args });
const result = (id: string, name: string, text: string, isError: boolean) => ({
	role: "toolResult",
	toolCallId: id,
	toolName: name,
	content: [{ type: "text", text }],
	isError,
});

async function setup() {
	const pi = fakePi();
	extension(pi as any);
	await pi.emit("session_start", { type: "session_start" }, fakeCtx());
	await pi.emit("before_agent_start", { type: "before_agent_start", messageType: "user", prompt: "go" }, fakeCtx());
	return pi;
}

async function step(pi: any, id: string, name: string, args: any, text: string, isError: boolean) {
	await pi.emit("message_end", { type: "message_end", message: assistant([call(id, name, args)]) });
	const msg = result(id, name, text, isError);
	const [out] = await pi.emit("message_end", { type: "message_end", message: msg });
	return out?.message ?? msg;
}

test("an identical failed retry gets a note appended to its result, earlier content kept", async () => {
	const pi = await setup();
	const args = { path: "nope.py" };
	const first = await step(pi, "c1", "read", args, "ENOENT: no such file", true);
	assert.equal(first.content.length, 1);
	const second = await step(pi, "c2", "read", args, "ENOENT: no such file", true);
	assert.equal(second.content.length, 2);
	assert.equal(second.content[0].text, "ENOENT: no such file");
	assert.match(second.content[1].text, /^\n\n\[loop-guard\] This exact `read` call has now failed 2 times/);
	assert.equal(second.role, "toolResult");
	assert.equal(second.isError, true);
});

test("rejected calls (no tool_result event) are covered through message_end", async () => {
	const pi = await setup();
	const args = { file: "x" };
	await step(pi, "c1", "edit", args, 'Validation failed for tool "edit": path is required', true);
	const second = await step(pi, "c2", "edit", args, 'Validation failed for tool "edit": path is required', true);
	assert.match(second.content.at(-1).text, /\[loop-guard\]/);
});

test("a run ending on 'I'll …' with no tool call is continued once with a nudge", async () => {
	const pi = await setup();
	await pi.emit("message_end", { type: "message_end", message: assistant([{ type: "text", text: "Found the bug. I'll fix it now." }], "stop") });
	const [r] = await pi.emit("agent_before_settle", { type: "agent_before_settle", outcome: "completed", entries: [], continue: false });
	assert.equal(r.continue, true);
	assert.equal(r.entries[0].type, "custom_message");
	assert.equal(r.entries[0].customType, CUSTOM_TYPE);
	assert.match(r.entries[0].content, /ends with "I'll fix it now" but you made no tool call/);
	// the same final message is not nudged twice
	const [again] = await pi.emit("agent_before_settle", { type: "agent_before_settle", outcome: "completed", entries: [], continue: false });
	assert.equal(again, undefined);
});

test("no nudge for a finished answer, an aborted run or a message with tool calls", async () => {
	const pi = await setup();
	const settle = (outcome = "completed") => pi.emit("agent_before_settle", { type: "agent_before_settle", outcome, entries: [], continue: false });
	await pi.emit("message_end", { type: "message_end", message: assistant([{ type: "text", text: "Done: all tests pass." }], "stop") });
	assert.deepEqual(await settle(), [undefined]);
	await pi.emit("message_end", { type: "message_end", message: assistant([{ type: "text", text: "I'll fix it." }], "aborted") });
	assert.deepEqual(await settle("aborted"), [undefined]);
	await pi.emit("message_end", { type: "message_end", message: assistant([{ type: "text", text: "I'll fix it." }, call("c", "read", {})]) });
	assert.deepEqual(await settle(), [undefined]);
});

test("registers the /loop-guard command", async () => {
	const pi = await setup();
	await step(pi, "c1", "bash", { command: "x" }, "boom", true);
	await step(pi, "c2", "bash", { command: "x" }, "boom", true);
	const ctx = fakeCtx();
	await pi.commands.get("loop-guard").handler("", ctx);
	assert.match(ctx.notes[0].message, /retry 1, repeat 0, streak 0, stall 0/);
});
