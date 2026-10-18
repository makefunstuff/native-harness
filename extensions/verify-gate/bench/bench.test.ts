import assert from "node:assert/strict";
import test from "node:test";
import { armTable, cacheTable, taskTable } from "./report.ts";
import { sessionStats } from "./run.ts";
import { prompt, ticketNames } from "./tickets.ts";

const assistant = (usage: object, content: object[] = []) => ({ type: "message", message: { role: "assistant", usage, content, stopReason: "stop" } });

test("sessionStats counts gate checks and rounds, and the cache use right after a gate message", () => {
	const entries = [
		assistant({ input: 5000, cacheRead: 0, output: 10 }, [{ type: "toolCall" }]),
		{ type: "message", message: { role: "toolResult", toolName: "edit", isError: true } },
		{ type: "custom", customType: "verify-gate", data: { ok: false } },
		{ type: "custom_message", customType: "verify-gate", content: "verify-gate: the project's check fails …" },
		assistant({ input: 300, cacheRead: 5200, output: 20 }),
		{ type: "custom", customType: "verify-gate", data: { ok: true } },
	];
	const st = sessionStats(entries as any);
	assert.equal(st.assistant_turns, 2);
	assert.equal(st.tool_calls, 1);
	assert.equal(st.edit_errors, 1);
	assert.equal(st.gate_checks, 2);
	assert.equal(st.gate_failures, 1);
	assert.equal(st.gate_rounds, 1);
	assert.equal(st.gate_gave_up, false);
	assert.deepEqual([st.after_gate_input, st.after_gate_cache_read], [300, 5200]);
});

test("report tables", () => {
	const row = { model: "llama.cpp/m", task: "t", passed: true, timed_out: false, self_confirmed: false, gate_rounds: 1, gate_gave_up: false, wall_s: 10, assistant_turns: 3, output_tokens: 100, input_tokens: 100, cache_read_tokens: 900, after_gate_input: 10, after_gate_cache_read: 90 };
	const arms = new Map([["local-gate", [row, { ...row, passed: false, self_confirmed: true, gate_rounds: 0 }]]]);
	assert.match(armTable(arms), /\| local-gate \| llama\.cpp\/m \| 2 \| 1\/2 \(50%\) \| 0 \| 1\/2 \(50%\) \| 1 \| 1\/1 \|/);
	assert.match(cacheTable(arms), /\| local-gate \| 90% \| 90% /);
	assert.match(taskTable(arms), /\| t \| 1\/2 \|/);
});

test("every ticket has a prompt naming the check", () => {
	assert.ok(ticketNames().length >= 8);
	for (const t of ticketNames()) assert.match(prompt(t), /node --test/);
});
