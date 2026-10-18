#!/usr/bin/env node
// Replay captured pi requests (bench/capture.mjs) on a llama.cpp server.
//
//   replay.ts replay BASE_URL OUT.jsonl PAYLOAD.json... [--arms off,on] [--rounds N] [--first-round N]
//     each request as sent ("off") and with thinking-guard's budget added ("on": the same fields
//     withBudget() adds); records how long the reply thinks and whether it ends in a tool call.
//
//   replay.ts cache BASE_URL PAYLOAD.json OUT.jsonl [--trials N] [--first-trial N] [--abort-chars N]
//     prompt-cache check, per trial back to back:
//       warm     the request with the budget (fills the slot)
//       budget   the same request again: is the prompt reused?
//       abort    the request without budget, connection closed after --abort-chars of thinking
//       reissue  the request plus the guard's note as a new user message (what the guard sends)
//     llama-server reports prompt_n (tokens processed) and cache_n (tokens reused) per request.
//
// BASE_URL is the server root, e.g. http://my-gpu-box:8080 (not stored anywhere).
import { appendFileSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { DEFAULTS, noteFor, withBudget } from "../guard.ts";

interface Result {
	wall_s: number;
	reasoning_chars: number;
	content_chars: number;
	tool_calls: string[];
	finish: string | null;
	budget_hit: boolean;
	aborted: boolean;
	prompt_n?: number;
	cache_n?: number;
	predicted_n?: number;
	reasoning_tail: string;
}

async function send(base: string, body: Record<string, unknown>, abortAfter?: number): Promise<Result> {
	const t0 = Date.now();
	const ctl = new AbortController();
	const res = await fetch(`${base.replace(/\/+$/, "")}/v1/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ ...body, stream: true }),
		signal: ctl.signal,
	});
	if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
	let reasoning = "", content = "", finish: string | null = null, timings: any, aborted = false, buf = "";
	const tools = new Map<number, string>();
	const decoder = new TextDecoder();
	try {
		for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
			buf += decoder.decode(chunk, { stream: true });
			let nl: number;
			while ((nl = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, nl).trim();
				buf = buf.slice(nl + 1);
				if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
				const d = JSON.parse(line.slice(6));
				if (d.timings) timings = d.timings;
				for (const ch of d.choices ?? []) {
					reasoning += ch.delta?.reasoning_content ?? "";
					content += ch.delta?.content ?? "";
					for (const tc of ch.delta?.tool_calls ?? []) if (tc.function?.name) tools.set(tc.index ?? 0, tc.function.name);
					finish = ch.finish_reason ?? finish;
				}
			}
			if (abortAfter && reasoning.length >= abortAfter) {
				aborted = true;
				ctl.abort();
				break;
			}
		}
	} catch (e) {
		if (!aborted) throw e;
	}
	return {
		wall_s: Math.round((Date.now() - t0) / 100) / 10,
		reasoning_chars: reasoning.length,
		content_chars: content.length,
		tool_calls: [...tools.values()],
		finish,
		budget_hit: reasoning.includes(DEFAULTS.budgetMessage.trim()),
		aborted,
		prompt_n: timings?.prompt_n,
		cache_n: timings?.cache_n,
		predicted_n: timings?.predicted_n,
		reasoning_tail: reasoning.slice(-200),
	};
}

function flag(args: string[], name: string, fallback: string): string {
	const i = args.indexOf(name);
	if (i < 0) return fallback;
	const v = args[i + 1];
	args.splice(i, 2);
	return v;
}

const record = (out: string, row: Record<string, unknown>) => {
	appendFileSync(out, JSON.stringify(row) + "\n");
	console.log(JSON.stringify(row));
};

async function main() {
	const args = process.argv.slice(2);
	const mode = args.shift();
	if (mode === "replay") {
		const arms = flag(args, "--arms", "off,on").split(",");
		const rounds = Number(flag(args, "--rounds", "1"));
		const firstRound = Number(flag(args, "--first-round", "1"));
		const [base, out, ...payloads] = args;
		for (let round = firstRound; round < firstRound + rounds; round++)
			for (const file of payloads) {
				const payload = JSON.parse(readFileSync(file, "utf8"));
				for (const arm of arms) {
					const body = arm === "on" ? withBudget(payload, DEFAULTS)! : payload;
					record(out, { case: basename(file, ".json"), round, arm, ...(await send(base, body)) });
				}
			}
	} else if (mode === "cache") {
		const trials = Number(flag(args, "--trials", "3"));
		const first = Number(flag(args, "--first-trial", "1"));
		const abortChars = Number(flag(args, "--abort-chars", String(DEFAULTS.maxThinkingChars)));
		const [base, file, out] = args;
		const payload = JSON.parse(readFileSync(file, "utf8"));
		const budget = withBudget(payload, DEFAULTS)!;
		const reissue = { ...payload, messages: [...payload.messages, { role: "user", content: noteFor(DEFAULTS, abortChars) }] };
		const steps: Array<[string, Record<string, unknown>, number | undefined]> = [
			["warm", budget, undefined],
			["budget", budget, undefined],
			["abort", payload, abortChars],
			["reissue", reissue, undefined],
		];
		for (let trial = first; trial < first + trials; trial++)
			for (const [step, body, abortAfter] of steps) {
				record(out, { trial, step, ...(await send(base, body, abortAfter)) });
				if (step === "abort") await new Promise((ok) => setTimeout(ok, 2000)); // let the server stop
			}
	} else {
		console.error("usage: replay.ts replay|cache ... (see the header of this file)");
		process.exit(2);
	}
}

await main();
