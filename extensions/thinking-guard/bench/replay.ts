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
// BASE_URL is the server root, e.g. http://my-gpu-box:8080 (not stored anywhere). REPLAY_API_KEY, when set, is
// sent as a bearer token (for servers behind a key, e.g. Strata); REPLAY_MODEL overrides the captured model id.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
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

// node:http rather than fetch: a request may queue behind others on a busy server for longer
// than fetch's fixed 300 s headers timeout.
function send(base: string, body: Record<string, unknown>, abortAfter?: number): Promise<Result> {
	const t0 = Date.now();
	const url = new URL(`${base.replace(/\/+$/, "")}/v1/chat/completions`);
	const data = JSON.stringify({ ...body, ...(process.env.REPLAY_MODEL ? { model: process.env.REPLAY_MODEL } : {}), stream: true });
	return new Promise((resolve, reject) => {
		let reasoning = "", content = "", finish: string | null = null, timings: any, aborted = false, buf = "";
		const tools = new Map<number, string>();
		const done = () =>
			resolve({
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
			});
		const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
			url,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"content-length": Buffer.byteLength(data),
					...(process.env.REPLAY_API_KEY ? { authorization: `Bearer ${process.env.REPLAY_API_KEY}` } : {}),
				},
			},
			(res) => {
				if (res.statusCode !== 200) {
					let err = "";
					res.on("data", (c) => (err += c));
					res.on("end", () => reject(new Error(`HTTP ${res.statusCode}: ${err}`)));
					return;
				}
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					buf += chunk;
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
					if (abortAfter && !aborted && reasoning.length >= abortAfter) {
						aborted = true;
						req.destroy();
						done();
					}
				});
				res.on("end", () => !aborted && done());
				res.on("error", (e) => !aborted && reject(e));
			},
		);
		req.on("error", (e) => !aborted && reject(e));
		req.end(data);
	});
}

/** send(), retried when a busy server drops the connection or answers 5xx (e.g. while it swaps models). */
async function sendRetrying(base: string, body: Record<string, unknown>, abortAfter?: number): Promise<Result> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await send(base, body, abortAfter);
		} catch (e) {
			if (attempt >= 4) throw e;
			console.error(`retry ${attempt} after: ${(e as Error).message}`);
			await new Promise((ok) => setTimeout(ok, 30_000 * attempt));
		}
	}
}

/** Rows already in OUT, to resume an interrupted run. */
function existing(out: string): any[] {
	return existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
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
		const have = new Set(existing(out).map((r) => `${r.case}#${r.round}#${r.arm}`));
		for (let round = firstRound; round < firstRound + rounds; round++)
			for (const file of payloads) {
				const payload = JSON.parse(readFileSync(file, "utf8"));
				for (const arm of arms) {
					if (have.has(`${basename(file, ".json")}#${round}#${arm}`)) continue;
					const body = arm === "on" ? withBudget(payload, DEFAULTS)! : payload;
					record(out, { case: basename(file, ".json"), round, arm, ...(await sendRetrying(base, body)) });
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
		const doneTrials = new Set(existing(out).filter((r) => r.step === "reissue").map((r) => r.trial));
		for (let trial = first; trial < first + trials; trial++) {
			if (doneTrials.has(trial)) continue;
			for (const [step, body, abortAfter] of steps) {
				record(out, { trial, step, ...(await sendRetrying(base, body, abortAfter)) });
				if (step === "abort") await new Promise((ok) => setTimeout(ok, 2000)); // let the server stop
			}
		}
	} else {
		console.error("usage: replay.ts replay|cache ... (see the header of this file)");
		process.exit(2);
	}
}

await main();
