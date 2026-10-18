// Experiments, switched by LLAMA_NATIVE_EXP (comma-separated). All of them are ordinary pi hooks,
// so the context-editing and decision experiments also run against the HTTP llama.cpp provider:
// the same policy, two transports, and the cost of each shows in the metrics.
//
//   server-cache    native only: cache like llama-server (re-tokenise the whole prompt, checkpoints
//                   only near the prompt end and at the last user message) instead of per-message
//                   segments with exact generated tokens
//   no-grammar      native only: no grammar constraint on tool calls (llama-server always applies it)
//   no-spec         native only: no speculative decoding
//   prune           `context` hook: replace tool output that is stale (a file read that was later
//                   re-read or changed; long command output a few turns old) by a one-line note,
//                   in batches of at least PRUNE_MIN chars, so the cache is edited rarely
//   done-check      `agent_before_settle` hook: when the model stops, ask it on a fork of the
//                   cache (native) or with a 1-token logprob request (HTTP) whether the work is
//                   complete and verified; if not, add a nudge and continue (at most twice)
//   helper-decide   done-check answered by the helper model instead of the main one
//   branch-compact  `session_before_compact` hook (native): write the summary on a fork of the
//                   cached conversation instead of a fresh request that re-reads it all
//   helper-compact  same, written by the helper model from the serialised conversation
//
// The helper model (LLAMA_NATIVE_HELPER_ARGS, an argument file) is a second model in the same
// process, e.g. a 2B model on one GPU next to the 27B.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { logMetrics } from "./metrics.ts";
import { getHelper, type Native } from "./native.ts";

export function experiments(): Set<string> {
	return new Set((process.env.LLAMA_NATIVE_EXP ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export function experimentFlags(): Record<string, unknown> {
	const e = experiments();
	return {
		cache_mode: e.has("server-cache") ? "server" : "segments",
		tool_grammar: !e.has("no-grammar"),
		use_spec: !e.has("no-spec"),
	};
}

const PRUNE_MIN = Number(process.env.LLAMA_NATIVE_PRUNE_MIN ?? 12000); // chars per batch
const PRUNE_KEEP_TURNS = 2;
const LONG_OUTPUT = 4000; // chars

export const DONE_QUESTION =
	"Before the task is closed, judge the work honestly.\n" +
	"A) The task is complete and verified: the tests (or another check) were run after the last change and pass.\n" +
	"B) Something is missing or unverified, or the last change was not tested.\n" +
	"Answer with A or B.";
export const DONE_NUDGE =
	"Not done yet: verify the work before you stop. Run the tests or otherwise check the result after your " +
	"last change, fix anything missing or failing, then finish with a short summary.";

// pi's compaction prompt (pi-coding-agent core/compaction/compaction.js, MIT), asked here after
// the cached conversation instead of after a serialised copy of it.
const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

// pi assistant message -> the OpenAI message pi's client sends for it
export function assistantToOpenAI(m: any): any {
	const text = (m.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
	const thinking = (m.content ?? []).filter((b: any) => b.type === "thinking").map((b: any) => b.thinking).join("");
	const calls = (m.content ?? []).filter((b: any) => b.type === "toolCall");
	const out: any = { role: "assistant", content: text || null };
	if (thinking) out.reasoning_content = thinking;
	if (calls.length)
		out.tool_calls = calls.map((c: any) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } }));
	return out;
}

function textOf(content: any): string {
	if (typeof content === "string") return content;
	return (content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
}

async function httpDecide(model: any, payload: any, messages: any[], question: string, labels: string[]) {
	const t0 = performance.now();
	const body = {
		model: payload.model,
		messages: [...messages, { role: "user", content: question }],
		tools: payload.tools,
		max_tokens: 1,
		temperature: 0,
		logprobs: true,
		top_logprobs: 20,
		stream: false,
		chat_template_kwargs: { ...(payload.chat_template_kwargs ?? {}), enable_thinking: false },
	};
	const res = await fetch(`${model.baseUrl.replace(/\/$/, "")}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: "Bearer none" },
		body: JSON.stringify(body),
	});
	const j: any = await res.json();
	const top = j.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs ?? [];
	const p = labels.map((l) => {
		const e = top.find((x: any) => x.token.trim() === l);
		return e ? Math.exp(e.logprob) : 0;
	});
	const z = p.reduce((a, b) => a + b, 0) || 1;
	return { probs: p.map((x) => x / z), mass: z, timings: { total_ms: performance.now() - t0, server: j.timings } };
}

export function installExperiments(pi: ExtensionAPI, native: () => Promise<Native>) {
	const E = experiments();
	if (E.size === 0) return;
	let lastPayload: any;
	let lastAssistant: any;
	let nudges = 0;
	const elided = new Set<string>();

	pi.on("before_provider_request", (event: any) => {
		const p = event.payload;
		if (p && Array.isArray(p.messages)) lastPayload = p;
	});
	pi.on("message_end", (event: any) => {
		if (event.message?.role === "assistant") lastAssistant = event.message;
	});

	if (E.has("prune")) {
		pi.on("context", (event: any) => {
			const msgs: any[] = event.messages;
			// tool call id -> {name, path, assistant turn index}
			const calls = new Map<string, { name: string; path?: string; turn: number }>();
			let turn = 0;
			const touches: { path: string; turn: number; idx: number }[] = [];
			msgs.forEach((m, idx) => {
				if (m.role !== "assistant") return;
				turn++;
				for (const b of m.content ?? []) {
					if (b.type !== "toolCall") continue;
					const path = typeof b.arguments?.path === "string" ? b.arguments.path : undefined;
					calls.set(b.id, { name: b.name, path, turn });
					if (path && ["read", "edit", "write"].includes(b.name)) touches.push({ path, turn, idx });
				}
			});
			const nTurns = turn;
			let fresh = 0;
			const candidates: string[] = [];
			msgs.forEach((m, idx) => {
				if (m.role !== "toolResult" || elided.has(m.toolCallId)) return;
				const c = calls.get(m.toolCallId);
				if (!c || c.turn > nTurns - PRUNE_KEEP_TURNS) return;
				const len = textOf(m.content).length;
				let stale = false;
				if (c.name === "read" && c.path) stale = touches.some((t) => t.path === c.path && t.idx > idx);
				if ((c.name === "bash" || c.name === "codemode") && len > LONG_OUTPUT) stale = true;
				if (stale && len > 200) {
					candidates.push(m.toolCallId);
					fresh += len;
				}
			});
			if (fresh >= PRUNE_MIN) {
				for (const id of candidates) elided.add(id);
				logMetrics({ kind: "prune", outputs: candidates.length, chars: fresh, total_elided: elided.size });
			}
			if (elided.size === 0) return;
			return {
				messages: msgs.map((m) => {
					if (m.role !== "toolResult" || !elided.has(m.toolCallId)) return m;
					const c = calls.get(m.toolCallId);
					const note =
						c?.name === "read"
							? `[Output removed to save context: ${c.path} was read again or changed later. Read it again if needed.]`
							: `[Old command output removed to save context. Re-run the command if you need it.]`;
					return { ...m, content: [{ type: "text", text: note }] };
				}),
			};
		});
	}

	if (E.has("done-check") || E.has("helper-decide")) {
		pi.on("agent_before_settle", async (event: any, ctx: any) => {
			if (nudges >= 2 || event.outcome !== "completed" || !lastPayload || !lastAssistant) return;
			if ((lastAssistant.content ?? []).some((b: any) => b.type === "toolCall")) return;
			const messages = [...lastPayload.messages, assistantToOpenAI(lastAssistant)];
			const provider = ctx.model?.provider;
			let r: any;
			let via: string;
			try {
				if (E.has("helper-decide")) {
					const h = await getHelper();
					const transcript = serializeConversation(convertToLlm(event.context?.contextMessages ?? []));
					r = await h.decide({
						messages: [
							{ role: "system", content: "You review the work of a coding agent." },
							{ role: "user", content: `<conversation>\n${transcript}\n</conversation>` },
							{ role: "assistant", content: "I have read the conversation." },
						],
						question: DONE_QUESTION,
						labels: ["A", "B"],
					});
					via = "helper";
				} else if (provider === "llama-native") {
					r = await (await native()).decide({
						messages,
						tools: lastPayload.tools,
						chat_template_kwargs: lastPayload.chat_template_kwargs,
						question: DONE_QUESTION,
						labels: ["A", "B"],
					});
					via = "native-branch";
				} else {
					r = await httpDecide(ctx.model, lastPayload, messages, DONE_QUESTION, ["A", "B"]);
					via = "http-logprobs";
				}
			} catch (e: any) {
				logMetrics({ kind: "decide", error: String(e?.message ?? e) });
				return;
			}
			const notDone = (r.probs?.[1] ?? 0) > 0.5;
			logMetrics({ kind: "decide", via, p_done: r.probs?.[0], nudge: notDone, timings: r.timings, mass: r.mass });
			if (!notDone) return;
			nudges++;
			return {
				entries: [{ type: "custom_message", customType: "llama-native-done-check", content: DONE_NUDGE, display: true }],
				continue: true,
			};
		});
	}

	if (E.has("branch-compact") || E.has("helper-compact")) {
		pi.on("session_before_compact", async (event: any, ctx: any) => {
			const { preparation } = event;
			const t0 = performance.now();
			try {
				let text: string;
				let timings: any;
				if (E.has("helper-compact")) {
					const h = await getHelper();
					const conv = serializeConversation(convertToLlm([...preparation.messagesToSummarize, ...preparation.turnPrefixMessages]));
					const r = await h.chat(
						{
							messages: [
								{ role: "system", content: "You are a context summarization assistant." },
								{ role: "user", content: `<conversation>\n${conv}\n</conversation>\n\n${SUMMARIZATION_PROMPT.replace("The messages above are", "The conversation above is")}` },
							],
							enable_thinking: false,
							max_tokens: 4096,
						},
						() => {},
					);
					text = r.content;
					timings = r.timings;
				} else {
					if (ctx.model?.provider !== "llama-native" || !lastPayload || !lastAssistant) return;
					const messages = [...lastPayload.messages, assistantToOpenAI(lastAssistant)];
					const r = await (await native()).branchComplete({
						messages,
						tools: lastPayload.tools,
						chat_template_kwargs: lastPayload.chat_template_kwargs,
						prompt: SUMMARIZATION_PROMPT,
						max_tokens: 4096,
					});
					text = r.text;
					timings = r.timings;
				}
				logMetrics({ kind: "compact", via: E.has("helper-compact") ? "helper" : "native-branch", ms: performance.now() - t0, chars: text?.length, timings });
				if (!text?.trim()) return;
				return {
					compaction: {
						summary: text,
						firstKeptEntryId: preparation.firstKeptEntryId,
						tokensBefore: preparation.tokensBefore,
					},
				};
			} catch (e: any) {
				logMetrics({ kind: "compact", error: String(e?.message ?? e) });
				return;
			}
		});
	}
	// default compaction timing, for comparison
	pi.on("session_compact", (event: any) => {
		logMetrics({ kind: "compacted", fromExtension: event.fromExtension, reason: event.reason });
	});
}
