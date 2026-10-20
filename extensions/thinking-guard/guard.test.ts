import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULTS, LlamaCppDetector, budgetHit, isGuarded, isLocalModel, isPrivateHost, loadConfig, looksLikeLlamaCppProps, noteFor, serverRoot, thinkingChars, withBudget } from "./guard.ts";

test("private hosts", () => {
	for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.9", "172.20.0.1", "100.100.1.1", "[::1]", "fd12::1", "gpu-box", "gpu.lan", "box.local", "x.tail1234.ts.net"]) // no-secrets: allow (made-up host names the rule must treat as private)
		assert.ok(isPrivateHost(h), h);
	for (const h of ["api.openai.com", "8.8.8.8", "172.32.0.1", "openrouter.ai", "2001:db8::1"]) assert.ok(!isPrivateHost(h), h); // no-secrets: allow (synthetic public fixtures: the test needs non-private hosts)
});

test("local models and scope", () => {
	const local = { provider: "llama.cpp", api: "openai-completions", baseUrl: "http://192.168.1.5:8080/v1" };
	const cloud = { provider: "anthropic", api: "anthropic-messages", baseUrl: "https://api.anthropic.com" };
	assert.ok(isLocalModel(local));
	assert.ok(!isLocalModel(cloud));
	assert.ok(isGuarded(local, DEFAULTS));
	assert.ok(!isGuarded(cloud, DEFAULTS));
	assert.ok(isGuarded(cloud, { ...DEFAULTS, scope: "all" }));
	assert.ok(!isGuarded(local, { ...DEFAULTS, enabled: false }));
});

test("config: file, then environment", () => {
	const dir = mkdtempSync(join(tmpdir(), "tg-cfg-"));
	try {
		writeFileSync(join(dir, "thinking-guard.json"), JSON.stringify({ maxThinkingChars: 5000, scope: "all", budget: "bogus" }));
		const cfg = loadConfig({ PI_CODING_AGENT_DIR: dir, PI_THINKING_GUARD_BUDGET_TOKENS: "1234" });
		assert.equal(cfg.maxThinkingChars, 5000);
		assert.equal(cfg.scope, "all");
		assert.equal(cfg.budget, "auto"); // invalid value falls back
		assert.equal(cfg.budgetTokens, 1234);
		assert.equal(loadConfig({ PI_CODING_AGENT_DIR: dir, PI_THINKING_GUARD_ENABLED: "0" }).enabled, false);
		writeFileSync(join(dir, "thinking-guard.json"), "{ not json");
		const warnings: string[] = [];
		assert.equal(loadConfig({ PI_CODING_AGENT_DIR: dir }, (m) => warnings.push(m)).maxThinkingChars, DEFAULTS.maxThinkingChars);
		assert.equal(warnings.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("budget is added to chat payloads, never overriding pi's own", () => {
	const p = { model: "m", messages: [{ role: "user", content: "hi" }], chat_template_kwargs: { enable_thinking: true } };
	const out = withBudget(p, DEFAULTS)!;
	assert.equal(out.thinking_budget_tokens, 3000);
	assert.equal(out.reasoning_budget_message, DEFAULTS.budgetMessage);
	assert.deepEqual(out.messages, p.messages, "history untouched");
	assert.equal((p as any).thinking_budget_tokens, undefined, "input not mutated");
	assert.equal(withBudget({ ...p, thinking_budget_tokens: 99 }, DEFAULTS)!.thinking_budget_tokens, 99);
	assert.equal(withBudget({ ...p, chat_template_kwargs: { enable_thinking: false } }, DEFAULTS), undefined);
	assert.equal(withBudget({ input: [] }, DEFAULTS), undefined);
	assert.equal(withBudget(null, DEFAULTS), undefined);
});

test("thinking length and budget detection", () => {
	const msg = { content: [{ type: "thinking", thinking: "abc" }, { type: "text", text: "zzzz" }, { type: "thinking", thinking: "de" }] };
	assert.equal(thinkingChars(msg), 5);
	assert.equal(thinkingChars({}), 0);
	assert.ok(!budgetHit(msg, DEFAULTS));
	assert.ok(budgetHit({ content: [{ type: "thinking", thinking: `long...${DEFAULTS.budgetMessage}` }] }, DEFAULTS));
	assert.match(noteFor(DEFAULTS, 9001), /after 9001 characters/);
});

test("llama.cpp detection probes /props once, private hosts only", async () => {
	assert.equal(serverRoot("http://h:8080/v1/"), "http://h:8080");
	assert.ok(looksLikeLlamaCppProps({ build_info: "b1-abc" }));
	assert.ok(!looksLikeLlamaCppProps({ object: "list" }));
	const calls: string[] = [];
	const fake = async (url: string) => {
		calls.push(url);
		return { ok: true, json: async () => (url.includes("10.0.0.2") ? { role: "router", build_info: "b3411" } : {}) };
	};
	const d = new LlamaCppDetector(fake);
	assert.equal(await d.isLlamaCpp("http://10.0.0.2:8080/v1"), true);
	assert.equal(await d.isLlamaCpp("http://10.0.0.2:8080"), true);
	assert.equal(await d.isLlamaCpp("http://10.0.0.3:8000/v1"), false);
	assert.equal(await d.isLlamaCpp("https://api.openai.com/v1"), false);
	assert.deepEqual(calls, ["http://10.0.0.2:8080/props", "http://10.0.0.3:8000/props"]);
	const failing = new LlamaCppDetector(async () => {
		throw new Error("ECONNREFUSED");
	});
	assert.equal(await failing.isLlamaCpp("http://127.0.0.1:1/v1"), false);
});
