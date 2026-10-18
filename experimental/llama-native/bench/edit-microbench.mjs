// Micro-benchmark of the one thing in-process access changes for context editing: after an old
// tool output in a long conversation is replaced (what the `prune` hook does), how much of the
// prompt must be processed again before the next answer?
//
//   node bench/edit-microbench.mjs native                # in-process binding (configs/qwen3.8-27b.args)
//   node bench/edit-microbench.mjs http http://127.0.0.1:18182
//
// Builds a conversation of a system prompt, a user task and 8 tool calls whose results are ~3k
// tokens each, sends it (warm-up), then sends it again with the result of call EDIT_AT replaced by
// a one-line note, and finally the unchanged conversation plus one new tool result (a normal
// append). max_tokens 1, thinking off: only prompt processing is measured.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { readArgs } = require("../extension/args.cjs");

const mode = process.argv[2];
const url = process.argv[3];
const N_CALLS = 8, EDIT_AT = 2;

function bigText(seed, lines) {
	let s = "", x = seed;
	for (let i = 0; i < lines; i++) {
		x = (x * 1103515245 + 12345) % 2147483648;
		s += `line ${i}: value=${x % 100000} status=${["ok", "warn", "fail"][x % 3]} path=src/mod${x % 37}/file${x % 91}.py\n`;
	}
	return s;
}
const tools = [{ type: "function", function: { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } }];
function conversation(edit) {
	const m = [
		{ role: "system", content: "You are a coding agent. Use tools." + " Follow the project conventions.".repeat(40) },
		{ role: "user", content: "Read the logs one by one and tell me which module fails most often." },
	];
	for (let i = 0; i < N_CALLS; i++) {
		const id = `call_${i}`;
		m.push({ role: "assistant", content: null, reasoning_content: `I will read log ${i}.`, tool_calls: [{ id, type: "function", function: { name: "read", arguments: JSON.stringify({ path: `logs/${i}.log` }) } }] });
		m.push({ role: "tool", tool_call_id: id, content: edit && i === EDIT_AT ? "[Output removed to save context.]" : bigText(i + 1, 110) });
	}
	return m;
}
const kwargs = { enable_thinking: false, preserve_thinking: true };

async function main() {
	let send;
	if (mode === "native") {
		const m = require("../native/build/llama_native.node");
		const h = await m.load([...readArgs(new URL("../configs/qwen3.8-27b.args", import.meta.url).pathname), "--parallel", "2"]);
		send = async (messages) => {
			const t0 = performance.now();
			const r = JSON.parse(await m.chat(h, JSON.stringify({ messages, tools, max_tokens: 1, chat_template_kwargs: kwargs }), () => {}));
			const t = r.timings;
			return { ms: performance.now() - t0, prompt_total: t.prompt_n, processed: t.prompt_decoded, reused: t.cache_n, restores: t.restores };
		};
	} else {
		send = async (messages) => {
			const t0 = performance.now();
			const res = await fetch(`${url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" },
				body: JSON.stringify({ model: "x", messages, tools, max_tokens: 1, stream: false, chat_template_kwargs: kwargs }) });
			const j = await res.json();
			const t = j.timings ?? {};
			return { ms: performance.now() - t0, prompt_total: (t.prompt_n ?? 0) + (t.cache_n ?? 0), processed: t.prompt_n, reused: t.cache_n };
		};
	}
	const out = { mode, url: url ? "loopback" : undefined };
	out.warm = await send(conversation(false));
	out.edited = await send(conversation(true));        // an old tool output replaced
	const appended = conversation(true);
	appended.push({ role: "assistant", content: null, reasoning_content: "One more.", tool_calls: [{ id: "call_x", type: "function", function: { name: "read", arguments: "{\"path\":\"logs/x.log\"}" } }] });
	appended.push({ role: "tool", tool_call_id: "call_x", content: bigText(99, 20) });
	out.append = await send(appended);                    // a normal next turn
	out.edited_again = await send(conversation(false));  // the edit undone (original text back)
	console.log(JSON.stringify(out));
	process.exit(0);
}
main();
