// thinking-guard logic, free of pi so the unit tests can call it directly: configuration, which
// models are guarded, the per-request thinking budget for llama.cpp servers, and the thinking
// length of a streamed message.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface GuardConfig {
	/** Master switch. */
	enabled: boolean;
	/** Which models are guarded: "local" (loopback, private-network and llama-native models) or "all". */
	scope: "local" | "all";
	/** Abort a reply once its thinking passes this many characters (no budget sent). */
	maxThinkingChars: number;
	/** Per-request thinking budget: "auto" sends it to llama.cpp servers found by probing /props,
	 *  "on" sends it to every guarded openai-completions model, "off" never sends it. */
	budget: "auto" | "on" | "off";
	/** Thinking budget in tokens. Local Qwen thinking runs at about 2.7 characters per token, so
	 *  3000 tokens is about 8k characters. */
	budgetTokens: number;
	/** Request field for the budget. llama.cpp reads thinking_budget_tokens (or reasoning_budget_tokens);
	 *  it ignores vLLM's thinking_token_budget. */
	budgetField: string;
	/** Text llama.cpp inserts before it closes the thinking block when the budget runs out. */
	budgetMessage: string;
	/** Abort threshold when a budget was sent: the fallback for a server that ignores the field. */
	fallbackChars: number;
	/** Aborts per user prompt; after that the model may think as long as it wants. */
	maxRetries: number;
	/** Message appended after an abort, before the request is issued again. {chars} is replaced. */
	note: string;
}

export const DEFAULTS: GuardConfig = {
	enabled: true,
	scope: "local",
	maxThinkingChars: 8000,
	budget: "auto",
	budgetTokens: 3000,
	budgetField: "thinking_budget_tokens",
	budgetMessage:
		"\n\nI have deliberated long enough. I stop thinking now and act: my next step is a tool call that checks or changes something, or the answer.\n",
	fallbackChars: 16000,
	maxRetries: 2,
	note:
		"[thinking-guard] Your previous reply was stopped after {chars} characters of thinking without an action. " +
		"Stop deliberating. Take the next concrete step now with a tool call (read, run or edit something) and keep your thinking short. " +
		"If you are unsure about something, check it with a tool instead of working it out in your head.",
};

const BUDGET_FIELDS = ["thinking_budget_tokens", "reasoning_budget_tokens", "thinking_token_budget", "thinking_budget"];

function agentDir(env: NodeJS.ProcessEnv): string {
	const dir = env.PI_CODING_AGENT_DIR;
	if (dir) return dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir;
	return join(homedir(), ".pi", "agent");
}

/** Path of the optional config file: <agent dir>/thinking-guard.json. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
	return env.PI_THINKING_GUARD_CONFIG ?? join(agentDir(env), "thinking-guard.json");
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T) => (values.includes(v as T) ? (v as T) : fallback);

/** Defaults, overridden by the config file, overridden by PI_THINKING_GUARD_* environment variables. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, warn: (m: string) => void = () => {}): GuardConfig {
	let file: Record<string, unknown> = {};
	const path = configPath(env);
	if (existsSync(path)) {
		try {
			file = JSON.parse(readFileSync(path, "utf8"));
		} catch (e) {
			warn(`thinking-guard: ignoring ${path}: ${(e as Error).message}`);
		}
	}
	const e = (k: string) => env[`PI_THINKING_GUARD_${k}`];
	const merged: Record<string, unknown> = { ...file };
	if (e("ENABLED") !== undefined) merged.enabled = !/^(0|false|off|no)$/i.test(e("ENABLED")!);
	if (e("SCOPE")) merged.scope = e("SCOPE");
	if (e("MAX_CHARS")) merged.maxThinkingChars = Number(e("MAX_CHARS"));
	if (e("BUDGET")) merged.budget = e("BUDGET");
	if (e("BUDGET_TOKENS")) merged.budgetTokens = Number(e("BUDGET_TOKENS"));
	if (e("FALLBACK_CHARS")) merged.fallbackChars = Number(e("FALLBACK_CHARS"));
	if (e("MAX_RETRIES")) merged.maxRetries = Number(e("MAX_RETRIES"));
	return {
		enabled: typeof merged.enabled === "boolean" ? merged.enabled : DEFAULTS.enabled,
		scope: oneOf(merged.scope, ["local", "all"] as const, DEFAULTS.scope),
		maxThinkingChars: num(merged.maxThinkingChars, DEFAULTS.maxThinkingChars),
		budget: oneOf(merged.budget, ["auto", "on", "off"] as const, DEFAULTS.budget),
		budgetTokens: num(merged.budgetTokens, DEFAULTS.budgetTokens),
		budgetField: str(merged.budgetField, DEFAULTS.budgetField),
		budgetMessage: str(merged.budgetMessage, DEFAULTS.budgetMessage),
		fallbackChars: num(merged.fallbackChars, DEFAULTS.fallbackChars),
		maxRetries: num(merged.maxRetries, DEFAULTS.maxRetries),
		note: str(merged.note, DEFAULTS.note),
	};
}

/** A host on this machine or a private network: loopback, RFC 1918, CGNAT/Tailscale, link-local,
 *  IPv6 ULA, single-label names and the usual private suffixes. */
export function isPrivateHost(host: string): boolean {
	const h = host.replace(/^\[|\]$/g, "").toLowerCase();
	if (h === "localhost" || h.endsWith(".localhost") || h === "::1") return true;
	const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
	}
	if (h.includes(":")) return /^f[cd]/.test(h) || h.startsWith("fe80:");
	if (!h.includes(".")) return true;
	return /\.(local|lan|internal|home\.arpa|home|ts\.net)$/.test(h);
}

export interface ModelLike {
	provider?: string;
	api?: string;
	baseUrl?: string;
	reasoning?: boolean;
}

/** Runs on this machine or the local network (or in pi's own process, llama-native). */
export function isLocalModel(model: ModelLike | undefined): boolean {
	if (!model) return false;
	if (model.provider === "llama-native" || model.api === "llama-native") return true;
	if (!model.baseUrl) return false;
	try {
		return isPrivateHost(new URL(model.baseUrl).hostname);
	} catch {
		return false;
	}
}

export function isGuarded(model: ModelLike | undefined, cfg: GuardConfig): boolean {
	if (!cfg.enabled || !model) return false;
	return cfg.scope === "all" || isLocalModel(model);
}

/** The server root of an OpenAI-compatible base URL: http://host:8080/v1 -> http://host:8080. */
export function serverRoot(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Does GET <root>/props answer like llama-server (or its router)? */
export function looksLikeLlamaCppProps(body: unknown): boolean {
	if (!body || typeof body !== "object") return false;
	const b = body as Record<string, unknown>;
	return typeof b.build_info === "string" || "default_generation_settings" in b;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Remembers, per server, whether it is llama.cpp. Only private hosts are probed. */
export class LlamaCppDetector {
	private cache = new Map<string, Promise<boolean>>();
	private fetchImpl: FetchLike;
	private timeoutMs: number;
	constructor(fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 2000) {
		this.fetchImpl = fetchImpl;
		this.timeoutMs = timeoutMs;
	}

	isLlamaCpp(baseUrl: string | undefined): Promise<boolean> {
		if (!baseUrl) return Promise.resolve(false);
		const root = serverRoot(baseUrl);
		let hit = this.cache.get(root);
		if (!hit) {
			hit = this.probe(root);
			this.cache.set(root, hit);
		}
		return hit;
	}

	private async probe(root: string): Promise<boolean> {
		try {
			if (!isPrivateHost(new URL(root).hostname)) return false;
			const res = await this.fetchImpl(`${root}/props`, { signal: AbortSignal.timeout(this.timeoutMs) });
			return res.ok && looksLikeLlamaCppProps(await res.json());
		} catch {
			return false;
		}
	}
}

/** Is thinking switched off in this chat-completions payload? */
export function thinkingDisabled(payload: Record<string, any>): boolean {
	return payload.chat_template_kwargs?.enable_thinking === false || payload.enable_thinking === false || payload.reasoning_effort === "none";
}

/** Add the thinking budget (and the message llama.cpp inserts when it runs out) to a payload.
 *  A budget pi already set (compat.thinkingTokenBudgetField) is kept. Returns undefined when the
 *  payload is left alone. */
export function withBudget(payload: unknown, cfg: GuardConfig): Record<string, unknown> | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const p = payload as Record<string, any>;
	if (!Array.isArray(p.messages) || thinkingDisabled(p)) return undefined;
	const out: Record<string, unknown> = { ...p };
	if (!BUDGET_FIELDS.some((f) => p[f] !== undefined)) out[cfg.budgetField] = cfg.budgetTokens;
	if (p.reasoning_budget_message === undefined && cfg.budgetMessage) out.reasoning_budget_message = cfg.budgetMessage;
	return out;
}

/** Characters of thinking in an assistant message so far. */
export function thinkingChars(message: unknown): number {
	const content = (message as { content?: unknown })?.content;
	if (!Array.isArray(content)) return 0;
	let n = 0;
	for (const c of content) if (c?.type === "thinking" && typeof c.thinking === "string") n += c.thinking.length;
	return n;
}

/** Did the server's budget end this message's thinking? (llama.cpp inserts the budget message.) */
export function budgetHit(message: unknown, cfg: GuardConfig): boolean {
	const marker = cfg.budgetMessage.trim();
	if (!marker) return false;
	const content = (message as { content?: unknown })?.content;
	if (!Array.isArray(content)) return false;
	return content.some((c: any) => c?.type === "thinking" && typeof c.thinking === "string" && c.thinking.includes(marker));
}

export function noteFor(cfg: GuardConfig, chars: number): string {
	return cfg.note.replaceAll("{chars}", String(chars));
}
