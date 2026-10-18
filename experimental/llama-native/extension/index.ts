// llama-native: llama.cpp inside pi's own process.
//
// Registers provider "llama-native". Its models use pi's built-in OpenAI-completions client
// unchanged (message conversion, tool parsing, thinking, usage, retries, abort), but the client's
// fetch() is answered in-process by a Node-API binding of libllama instead of llama-server over
// HTTP. So pi builds exactly the same request as for its llama.cpp provider; only the transport
// and what runs behind it differ.
//
// Configuration (environment):
//   LLAMA_NATIVE_ARGS     llama-server style argument file (default: ../configs/qwen3.8-27b.args)
//   LLAMA_NATIVE_ADDON    path of llama_native.node (default: ../native/build/llama_native.node)
//   LLAMA_NATIVE_MODEL    model id to mirror from the llama.cpp provider in models.json (default qwen3.8-27b)
//   LLAMA_NATIVE_EXP      comma-separated experiments, see experiments.ts
//   LLAMA_NATIVE_METRICS  JSONL file for per-request metrics (or a file named in "<path>.target")
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { streamSimple as streamSimpleOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installExperiments, experimentFlags } from "./experiments.ts";
import { logMetrics } from "./metrics.ts";
import { getNative } from "./native.ts";

const HERE = dirname(realpathSync(fileURLToPath(import.meta.url)));
const require_ = createRequire(join(HERE, "index.ts"));
const { readArgs } = require_("./args.cjs");

export const PROVIDER = "llama-native";
const BASE_URL = "http://llama-native.invalid/v1";

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

// Mirror the llama.cpp provider's entry for the same model (compat, thinking levels, limits), so
// the in-process model behaves like the HTTP one in every pi setting.
function mirroredModel(id: string): any {
	let src: any = undefined;
	try {
		const mj = JSON.parse(readFileSync(join(agentDir(), "models.json"), "utf8"));
		src = (mj.providers?.["llama.cpp"]?.models ?? []).find((m: any) => m.id === id);
	} catch {}
	const m: any = {
		id,
		name: `${src?.name ?? id} (in-process)`,
		reasoning: src?.reasoning ?? true,
		input: ["text"], // the binding does not load the vision projector
		contextWindow: src?.contextWindow ?? 131072,
		maxTokens: src?.maxTokens ?? 32768,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
	for (const k of ["compat", "thinking", "tokenizer"]) if (src?.[k] !== undefined) m[k] = src[k];
	return m;
}

function sse(obj: any): Uint8Array {
	return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

let loadLogged = false;

// fetch() for the OpenAI client: POST {BASE_URL}/chat/completions, answered in-process as an
// OpenAI chat-completions SSE stream.
async function nativeFetch(input: any, init?: any): Promise<Response> {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	if (!url.endsWith("/chat/completions")) {
		return new Response(JSON.stringify({ error: { message: `llama-native: ${url} not supported` } }), { status: 404 });
	}
	const bodyText = typeof init?.body === "string" ? init.body : await new Response(init?.body).text();
	const payload = JSON.parse(bodyText);
	const native = await getNative(argsFile(), addonPath());
	if (!loadLogged) {
		loadLogged = true;
		logMetrics({ kind: "load", ms: native.loadMs });
	}
	const signal: AbortSignal | undefined = init?.signal;
	const req: any = {
		messages: payload.messages,
		tools: payload.tools ?? [],
		reasoning_effort: payload.reasoning_effort,
		chat_template_kwargs: payload.chat_template_kwargs,
		max_tokens: payload.max_tokens ?? payload.max_completion_tokens,
		temperature: payload.temperature,
		top_p: payload.top_p,
		top_k: payload.top_k,
		min_p: payload.min_p,
		seed: payload.seed,
		parallel_tool_calls: payload.parallel_tool_calls,
		...experimentFlags(),
	};
	for (const k of Object.keys(req)) if (req[k] === undefined) delete req[k];
	const id = `chatcmpl-native-${Date.now()}`;
	const created = Math.floor(Date.now() / 1000);
	const model = payload.model;
	const chunk = (delta: any, finish: string | null = null, extra: any = {}) => ({
		id, object: "chat.completion.chunk", created, model,
		choices: [{ index: 0, delta, finish_reason: finish }], ...extra,
	});
	const t0 = performance.now();
	let ttft: number | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start: async (ctl) => {
			const onAbort = () => native.abort();
			signal?.addEventListener("abort", onAbort, { once: true });
			try {
				const res = await native.chat(req, (d: any) => {
					if (ttft === undefined) ttft = performance.now() - t0;
					if (d.t === "r") ctl.enqueue(sse(chunk({ reasoning_content: d.d })));
					else if (d.t === "c") ctl.enqueue(sse(chunk({ content: d.d })));
				});
				if (res.error) throw new Error(res.error);
				if (ttft === undefined && (res.tool_calls?.length || res.content)) ttft = performance.now() - t0;
				res.tool_calls?.forEach((c: any, i: number) => {
					ctl.enqueue(sse(chunk({ tool_calls: [{ index: i, id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } }] })));
				});
				const fin = res.finish_reason === "aborted" ? "stop" : res.finish_reason;
				const t = res.timings ?? {};
				const usage = {
					prompt_tokens: t.prompt_n ?? 0,
					completion_tokens: t.predicted_n ?? 0,
					total_tokens: (t.prompt_n ?? 0) + (t.predicted_n ?? 0),
					prompt_tokens_details: { cached_tokens: t.cache_n ?? 0 },
				};
				ctl.enqueue(sse(chunk({}, fin, { usage, timings: t })));
				ctl.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
				logMetrics({ kind: "chat", total_ms: performance.now() - t0, ttft_ms: ttft ?? null,
					n_messages: payload.messages?.length ?? 0, timings: t, parse_error: res.parse_error || undefined,
					finish_reason: res.finish_reason });
				ctl.close();
			} catch (e: any) {
				logMetrics({ kind: "chat", error: String(e?.message ?? e) });
				ctl.error(e);
			} finally {
				signal?.removeEventListener("abort", onAbort);
			}
		},
	});
	return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function argsFile(): string {
	return process.env.LLAMA_NATIVE_ARGS ?? resolve(HERE, "../configs/qwen3.8-27b.args");
}
function addonPath(): string {
	return process.env.LLAMA_NATIVE_ADDON ?? resolve(HERE, "../native/build/llama_native.node");
}

export default function (pi: ExtensionAPI) {
	if (!existsSync(addonPath())) return; // not built: stay out of the way
	const modelId = process.env.LLAMA_NATIVE_MODEL ?? "qwen3.8-27b";
	pi.registerProvider(PROVIDER, {
		baseUrl: BASE_URL,
		apiKey: "none",
		api: "llama-native",
		models: [mirroredModel(modelId)],
		streamSimple: (model: any, context: any, options: any) =>
			streamSimpleOpenAICompletions({ ...model, api: "openai-completions" }, context, { ...options, fetch: nativeFetch }),
	} as any);
	installExperiments(pi, () => getNative(argsFile(), addonPath()));
}

export { readArgs };
