// thinking-guard: stop runaway thinking. See README.md.
//
// 1. Budget: llama.cpp servers get a per-request thinking budget (thinking_budget_tokens) and a
//    short message the server inserts when it runs out, so the model closes its thinking and acts.
//    Nothing is aborted and nothing in the history changes.
// 2. Fallback: past maxThinkingChars of thinking (fallbackChars when a budget was sent), the reply
//    is aborted and the request issued again with a "stop deliberating, act with a tool" note
//    appended. pi drops aborted replies from the context, so the new request is the old one plus
//    the note: append-only, the prompt cache of hybrid models survives.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { LlamaCppDetector, budgetHit, configPath, isGuarded, loadConfig, noteFor, thinkingChars, withBudget, type GuardConfig } from "./guard.ts";

export const CUSTOM_TYPE = "thinking-guard";

export interface GuardOptions {
	config?: GuardConfig;
	detector?: LlamaCppDetector;
}

export default function thinkingGuard(pi: ExtensionAPI, options: GuardOptions = {}) {
	const warnings: string[] = [];
	const cfg = options.config ?? loadConfig(process.env, (m) => warnings.push(m));
	const detector = options.detector ?? new LlamaCppDetector();

	let budgetSent = false; // the request being streamed carried a thinking budget
	let aborting = false; // we aborted the current reply
	let pending: { chars: number } | undefined; // re-issue once the aborted run has settled
	let retries = 0; // aborts since the last user prompt
	const events: Array<Record<string, unknown>> = []; // flushed to the session when the run settles
	const totals = { aborts: 0, budgetHits: 0, gaveUp: 0 };

	const notify = (ctx: ExtensionContext, message: string, level: "info" | "warning" = "info") => {
		if (ctx.hasUI) ctx.ui.notify(message, level);
	};

	pi.on("session_start", (_event, ctx) => {
		for (const w of warnings.splice(0)) notify(ctx, w, "warning");
	});

	pi.on("before_agent_start", (event) => {
		if (event.messageType === "user") retries = 0;
	});

	pi.on("before_provider_request", async (event, ctx) => {
		budgetSent = false;
		const model = ctx.model;
		if (!isGuarded(model, cfg) || cfg.budget === "off" || model?.api !== "openai-completions") return undefined;
		if (cfg.budget === "auto" && !(await detector.isLlamaCpp(model.baseUrl))) return undefined;
		const payload = withBudget(event.payload, cfg);
		if (payload) budgetSent = true;
		return payload;
	});

	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") aborting = false;
	});

	pi.on("message_update", (event, ctx) => {
		if (aborting || event.assistantMessageEvent.type !== "thinking_delta") return;
		if (!isGuarded(ctx.model, cfg)) return;
		const limit = budgetSent ? cfg.fallbackChars : cfg.maxThinkingChars;
		if (!limit) return;
		const chars = thinkingChars(event.message);
		if (chars <= limit) return;
		if (retries >= cfg.maxRetries) {
			if (retries === cfg.maxRetries) {
				retries++; // report once per prompt
				totals.gaveUp++;
				events.push({ kind: "gave-up", chars, model: ctx.model?.id });
				notify(ctx, `thinking-guard: ${cfg.maxRetries} aborts already for this prompt; letting the model think`, "warning");
			}
			return;
		}
		aborting = true;
		retries++;
		totals.aborts++;
		pending = { chars };
		events.push({ kind: "abort", chars, budgetSent, model: ctx.model?.id, attempt: retries });
		notify(ctx, `thinking-guard: stopped a reply after ${chars} characters of thinking; asking the model to act`, "warning");
		ctx.abort();
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant" || !budgetSent) return;
		if (budgetHit(event.message, cfg)) {
			totals.budgetHits++;
			events.push({ kind: "budget", chars: thinkingChars(event.message), model: ctx.model?.id });
		}
	});

	pi.on("agent_settled", (event) => {
		for (const e of events.splice(0)) pi.appendEntry(CUSTOM_TYPE, e);
		const reissue = pending;
		pending = undefined;
		if (!reissue || !event.aborted) return;
		// pi runs this after the settle (it defers turns started from agent_settled)
		pi.sendMessage(
			{ customType: CUSTOM_TYPE, content: noteFor(cfg, reissue.chars), display: true, details: { chars: reissue.chars, attempt: retries } },
			{ triggerTurn: true },
		);
	});

	pi.registerCommand("thinking-guard", {
		description: "Show thinking-guard settings and what it did in this session; `on` / `off` toggles it",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on" || arg === "off") cfg.enabled = arg === "on";
			const model = ctx.model;
			const budget =
				cfg.budget === "off" || model?.api !== "openai-completions"
					? "no"
					: cfg.budget === "on"
						? "yes"
						: (await detector.isLlamaCpp(model.baseUrl))
							? "yes (llama.cpp)"
							: "no (not llama.cpp)";
			const lines = [
				`thinking-guard ${cfg.enabled ? "on" : "off"} (scope: ${cfg.scope}; config: ${configPath()})`,
				`current model ${model ? `${model.provider}/${model.id}` : "none"}: ${isGuarded(model, cfg) ? "guarded" : "not guarded"}, budget ${isGuarded(model, cfg) ? budget : "no"}`,
				`budget ${cfg.budgetTokens} tokens; abort past ${cfg.maxThinkingChars} chars (${cfg.fallbackChars} with a budget); ${cfg.maxRetries} aborts per prompt`,
				`this session: ${totals.aborts} aborts, ${totals.budgetHits} budget stops, ${totals.gaveUp} prompts left to think`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
