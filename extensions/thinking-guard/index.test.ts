import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeCtx, fakePi } from "../../test/lib/fake-pi.ts";
import { DEFAULTS, LlamaCppDetector, type GuardConfig } from "./guard.ts";
import extension, { CUSTOM_TYPE } from "./index.ts";

const LOCAL = { provider: "llama.cpp", id: "qwen", api: "openai-completions", baseUrl: "http://192.168.1.5:18080/v1", reasoning: true };
const CLOUD = { provider: "anthropic", id: "claude", api: "anthropic-messages", baseUrl: "https://api.anthropic.com", reasoning: true };

function setup(config: Partial<GuardConfig> = {}, llamaCpp = false, model: any = LOCAL) {
	const pi = fakePi();
	const detector = new LlamaCppDetector(async () => ({ ok: true, json: async () => (llamaCpp ? { build_info: "b1" } : {}) }));
	extension(pi as any, { config: { ...DEFAULTS, ...config }, detector });
	let aborts = 0;
	const ctx = fakeCtx({ model, abort: () => void aborts++ });
	const sent = () => pi.calls.filter((c) => c.method === "sendMessage");
	const entries = () => pi.calls.filter((c) => c.method === "appendEntry").map((c) => c.args[1]);
	return { pi, ctx, aborts: () => aborts, sent, entries };
}

// Stream an assistant reply whose thinking grows in steps of `step` characters up to `total`.
async function streamThinking(pi: any, ctx: any, total: number, step = 1000, tail = "") {
	const message: any = { role: "assistant", content: [{ type: "thinking", thinking: "" }] };
	await pi.emit("message_start", { message }, ctx);
	for (let n = 0; n < total; n += step) {
		message.content[0].thinking += "x".repeat(Math.min(step, total - n));
		await pi.emit("message_update", { message, assistantMessageEvent: { type: "thinking_delta", delta: "x" } }, ctx);
	}
	message.content[0].thinking += tail;
	await pi.emit("message_end", { message }, ctx);
	return message;
}

test("short thinking passes untouched", async () => {
	const { pi, ctx, aborts, sent } = setup();
	await pi.emit("before_agent_start", { messageType: "user", prompt: "go" }, ctx);
	await streamThinking(pi, ctx, 7000);
	await pi.emit("agent_settled", { aborted: false }, ctx);
	assert.equal(aborts(), 0);
	assert.equal(sent().length, 0);
});

test("runaway thinking is aborted and re-issued with the note appended", async () => {
	const { pi, ctx, aborts, sent, entries } = setup();
	await pi.emit("before_agent_start", { messageType: "user", prompt: "go" }, ctx);
	await streamThinking(pi, ctx, 20000);
	assert.equal(aborts(), 1, "aborted once, not on every later delta");
	await pi.emit("agent_settled", { aborted: true }, ctx);
	const [call] = sent();
	assert.ok(call, "note sent");
	assert.equal(call.args[0].customType, CUSTOM_TYPE);
	assert.match(call.args[0].content, /stopped after 9000 characters/);
	assert.deepEqual(call.args[1], { triggerTurn: true });
	assert.equal(entries()[0].kind, "abort");
});

test("a user abort is not re-issued", async () => {
	const { pi, ctx, sent } = setup();
	await pi.emit("before_agent_start", { messageType: "user", prompt: "go" }, ctx);
	await streamThinking(pi, ctx, 3000);
	await pi.emit("agent_settled", { aborted: true }, ctx);
	assert.equal(sent().length, 0);
});

test("gives up after maxRetries aborts per prompt, resets on the next prompt", async () => {
	const { pi, ctx, aborts, entries } = setup({ maxRetries: 2 });
	await pi.emit("before_agent_start", { messageType: "user", prompt: "go" }, ctx);
	for (let i = 0; i < 3; i++) {
		await streamThinking(pi, ctx, 10000);
		await pi.emit("agent_settled", { aborted: aborts() > i }, ctx);
		await pi.emit("before_agent_start", { messageType: "custom", message: {} }, ctx);
	}
	assert.equal(aborts(), 2);
	assert.deepEqual(entries().map((e) => e.kind), ["abort", "abort", "gave-up"]);
	await pi.emit("before_agent_start", { messageType: "user", prompt: "again" }, ctx);
	await streamThinking(pi, ctx, 10000);
	assert.equal(aborts(), 3);
});

test("cloud models are not guarded by default", async () => {
	const local = setup({}, false, CLOUD);
	await local.pi.emit("before_agent_start", { messageType: "user", prompt: "go" }, local.ctx);
	await streamThinking(local.pi, local.ctx, 20000);
	assert.equal(local.aborts(), 0);
	const all = setup({ scope: "all" }, false, CLOUD);
	await all.pi.emit("before_agent_start", { messageType: "user", prompt: "go" }, all.ctx);
	await streamThinking(all.pi, all.ctx, 20000);
	assert.equal(all.aborts(), 1);
});

test("llama.cpp gets a budget; the abort then waits for fallbackChars", async () => {
	const { pi, ctx, aborts, entries } = setup({}, true);
	const payload = { model: "qwen", messages: [{ role: "user", content: "go" }] };
	const [out] = await pi.emit("before_provider_request", { payload }, ctx);
	assert.equal(out.thinking_budget_tokens, 3000);
	await pi.emit("before_agent_start", { messageType: "user", prompt: "go" }, ctx);
	await streamThinking(pi, ctx, 12000, 1000, DEFAULTS.budgetMessage);
	assert.equal(aborts(), 0, "under the fallback threshold");
	await pi.emit("agent_settled", { aborted: false }, ctx);
	assert.equal(entries()[0].kind, "budget");
	await pi.emit("before_provider_request", { payload }, ctx);
	await streamThinking(pi, ctx, 17000);
	assert.equal(aborts(), 1, "server ignored the budget: fallback abort");
});

test("no budget for servers that are not llama.cpp, or when budget is off", async () => {
	const payload = { model: "qwen", messages: [] };
	const notLlama = setup({}, false);
	assert.deepEqual(await notLlama.pi.emit("before_provider_request", { payload }, notLlama.ctx), [undefined]);
	const off = setup({ budget: "off" }, true);
	assert.deepEqual(await off.pi.emit("before_provider_request", { payload }, off.ctx), [undefined]);
	const on = setup({ budget: "on" }, false);
	const [out] = await on.pi.emit("before_provider_request", { payload }, on.ctx);
	assert.equal(out.thinking_budget_tokens, 3000);
});

test("/thinking-guard reports and toggles", async () => {
	const { pi, ctx, aborts } = setup();
	const cmd = pi.commands.get("thinking-guard");
	await cmd.handler("off", ctx);
	assert.match(ctx.notes.at(-1).message, /thinking-guard off/);
	await pi.emit("before_agent_start", { messageType: "user", prompt: "go" }, ctx);
	await streamThinking(pi, ctx, 20000);
	assert.equal(aborts(), 0);
	await cmd.handler("on", ctx);
	assert.match(ctx.notes.at(-1).message, /thinking-guard on .*\n.*guarded/);
});
