// loop-guard: catch blind retries, no-progress repeats and runs that stop on "I'll …".
//
// Corrections are appended, never rewritten into history (hybrid Qwen models re-read the whole
// prompt when an earlier message changes):
//   - a tool-result note is added to the newest tool result when pi finalizes it (`message_end`,
//     before it is saved or sent), so calls pi rejects before running them are covered too;
//   - a stall nudge is a new message at the end, with one more model request (`agent_before_settle`).
// Rules and wording: guard.ts. PI_LOOP_GUARD=off (or -retry,-repeat,-streak,-stall) turns rules off.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LoopGuard, parseOptions, resultText } from "./guard.ts";

export const CUSTOM_TYPE = "loop-guard";

export default function (pi: ExtensionAPI) {
	const guard = new LoopGuard(parseOptions(process.env.PI_LOOP_GUARD));
	// tool call id -> name and arguments, from the assistant message that made the call
	const calls = new Map<string, { name: string; args: unknown }>();
	let lastAssistant: any;

	pi.on("session_start", () => {
		guard.reset();
		calls.clear();
		lastAssistant = undefined;
	});

	pi.on("before_agent_start", (event: any) => {
		if (event.messageType === "user") guard.newPrompt();
	});

	pi.on("message_end", (event: any) => {
		const m = event.message;
		if (m?.role === "assistant") {
			lastAssistant = m;
			for (const c of m.content ?? []) if (c?.type === "toolCall") calls.set(c.id, { name: c.name, args: c.arguments });
			return;
		}
		if (m?.role !== "toolResult") return;
		const call = calls.get(m.toolCallId);
		calls.delete(m.toolCallId);
		const note = guard.onResult(m.toolName ?? call?.name ?? "?", call?.args ?? {}, resultText(m.content), !!m.isError);
		if (!note) return;
		return { message: { ...m, content: [...(m.content ?? []), { type: "text", text: `\n\n${note.text}` }] } };
	});

	pi.on("agent_before_settle", (event: any) => {
		const m = lastAssistant;
		if (event.outcome !== "completed" || !m || m.stopReason !== "stop") return;
		if ((m.content ?? []).some((c: any) => c?.type === "toolCall")) return;
		const note = guard.onFinal(resultText(m.content));
		if (!note) return;
		lastAssistant = undefined;
		return {
			entries: [{ type: "custom_message", customType: CUSTOM_TYPE, content: note.text, display: true }],
			continue: true,
		};
	});

	pi.registerCommand("loop-guard", {
		description: "Show how often loop-guard stepped in this session",
		handler: async (_args, ctx) => {
			const f = guard.fired;
			ctx.ui.notify(`loop-guard: retry ${f.retry}, repeat ${f.repeat}, streak ${f.streak}, stall ${f.stall}`, "info");
		},
	});
}
