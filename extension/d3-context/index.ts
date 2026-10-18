// d3-context: a decision model manages the agent's context.
//
// Before each model request (pi's `context` hook) the extension looks at the large items in the
// transcript (tool outputs, file reads, long old assistant turns) and, every few turns, asks the
// local d3 decision model (System One wire, POST <D3_URL>/systemone):
//   - whether the agent is at a subtask boundary;
//   - for each item: keep, summarise or drop, for the agent's current subgoal.
// These are separate small calls, not one joint call: the server runs every question of a d3
// request as its own full pass over the whole state, so a joint call costs n_questions x state.
// For items marked summarise/drop, a second call asks which of their key lines (paths, errors,
// failing tests, values) must be pinned. At a boundary (or, as a fallback, when the context is
// close to full) the decisions are applied: the item is replaced by a stub holding its pinned
// lines (drop) or by an extractive summary plus the pins (summarise). Applied edits are sticky,
// so the prompt prefix stays stable between edits (provider prompt caches keep working).
// d3 does not generate text: summaries are extractive, chosen lines only. Checks run in the
// background, so the agent never waits for them; their edits apply from the next request on.
//
// Every decision is logged with its probabilities (D3_LOG, JSONL), so mistakes can be traced.
//
// Environment:
//   D3_URL            base URL ending in /v1 (required; no default, so no host is baked in)
//   D3_MODEL          model name sent to the endpoint (default vllm-d3-flash)
//   D3_LOG            JSONL log path (optional)
//   D3_CHECK_TURNS    assistant turns between checks (default 2)
//   D3_MIN_ITEM       smallest item judged, chars (default 1500)
//   D3_KEEP_TURNS     results of the newest N assistant turns are never touched (default 2)
//   D3_PRESSURE       apply decisions without a boundary once the context is this many
//                     estimated tokens (default 80000)
//   D3_MIN_SAVE       do not edit (and break the prompt cache) to save fewer chars (default 4000)
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";

const URL = (process.env.D3_URL ?? "").replace(/\/$/, "");
const MODEL = process.env.D3_MODEL ?? "vllm-d3-flash";
const LOG = process.env.D3_LOG;
const CHECK_TURNS = Number(process.env.D3_CHECK_TURNS ?? 2);
const MIN_ITEM = Number(process.env.D3_MIN_ITEM ?? 1500);
const KEEP_TURNS = Number(process.env.D3_KEEP_TURNS ?? 2);
const PRESSURE = Number(process.env.D3_PRESSURE ?? 80000);
const MIN_SAVE = Number(process.env.D3_MIN_SAVE ?? 4000);
const STATE_BUDGET = 15000; // chars of state per call (d3-flash has an 8k-token context)
const PINS_PER_ITEM = 6;
const CHARS_PER_TOKEN = 3.5;

type Decision = "keep" | "summarise" | "drop";
interface Item {
	key: string;
	idx: number; // message index
	turn: number; // assistant turn that produced it
	label: string;
	text: string;
	kind: "tool" | "assistant";
}
interface Applied {
	decision: Decision;
	replacement: string;
}

function log(rec: any) {
	if (LOG) appendFileSync(LOG, JSON.stringify({ t: Date.now() / 1000, ...rec }) + "\n");
}

function textOf(content: any): string {
	if (typeof content === "string") return content;
	return (content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
}

function msgChars(m: any): number {
	let n = 0;
	for (const b of typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content ?? []) {
		if (b.type === "text") n += b.text.length;
		else if (b.type === "thinking") n += (b.thinking ?? "").length;
		else if (b.type === "toolCall") n += JSON.stringify(b.arguments ?? {}).length + 20;
	}
	return n;
}

function short(s: string, n: number) {
	s = s.replace(/\s+/g, " ").trim();
	return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// agents prefix most commands with `cd <work dir> &&`, which says nothing about the command
const CD_PREFIX = /^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/;

function callLabel(c: any): string {
	if (!c) return "tool output";
	const a = c.arguments ?? {};
	if (typeof a.path === "string") return `${c.name} ${a.path}`;
	if (typeof a.command === "string") return `${c.name}: ${short(a.command.replace(CD_PREFIX, ""), 100)}`;
	if (typeof a.code === "string") return `${c.name}: ${short(a.code, 100)}`;
	return `${c.name} ${short(JSON.stringify(a), 100)}`;
}

function excerpt(text: string, head = 520, tail = 320): string {
	if (text.length <= head + tail + 40) return text;
	return `${text.slice(0, head)}\n[... ${text.length - head - tail} chars ...]\n${text.slice(-tail)}`;
}

// lines worth pinning: paths, errors, failing tests, assertions, locations
const KEY_LINE = /(Error|Exception|Traceback|FAIL|failed|assert|expected|!=|line \d+|\w[\w./-]*\.(py|md|json|csv|txt|log|ini|toml|cfg|diff)\b|^\s*(def|class) \w+)/;

function keyLines(text: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of text.split("\n")) {
		const l = raw.trim();
		if (l.length < 6 || l.length > 240 || seen.has(l) || !KEY_LINE.test(l)) continue;
		seen.add(l);
		out.push(l);
	}
	// spread the candidates over the whole output, not just its start
	if (out.length <= PINS_PER_ITEM) return out;
	const step = out.length / PINS_PER_ITEM;
	return Array.from({ length: PINS_PER_ITEM }, (_, i) => out[Math.floor(i * step)]);
}

function summarise(text: string): string {
	const lines = text.split("\n");
	if (lines.length <= 24) return text.slice(0, 1500);
	const head = lines.slice(0, 8);
	const tail = lines.slice(-8);
	const mid = lines.slice(8, -8).filter((l) => KEY_LINE.test(l)).slice(0, 12);
	return [...head, `[... ${lines.length - 16} lines, key lines kept:]`, ...mid, "[...]", ...tail].join("\n").slice(0, 2500);
}

async function systemOne(state: string, questions: Record<string, any>) {
	const t0 = performance.now();
	const res = await fetch(`${URL}/systemone`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ model: MODEL, state, questions }),
		signal: AbortSignal.timeout(60000),
	});
	const j: any = await res.json();
	if (!res.ok || !j.answers) throw new Error(`d3 HTTP ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
	return { answers: j.answers as Record<string, any>, ms: performance.now() - t0, usage: j.usage };
}

export default function (pi: ExtensionAPI) {
	if (!URL) {
		console.error("d3-context: D3_URL is not set; extension inactive");
		return;
	}
	const applied = new Map<string, Applied>();
	let lastCheckTurn = 0;
	let task = "";
	let running: Promise<unknown> | undefined;

	pi.on("before_provider_request", (event: any) => {
		const p = event.payload;
		if (!p || !Array.isArray(p.messages)) return;
		let reasoning = 0;
		for (const m of p.messages) reasoning += (m.reasoning_content ?? "").length;
		log({ kind: "request", messages: p.messages.length, payload_chars: JSON.stringify(p.messages).length, reasoning_chars: reasoning });
	});

	pi.on("context", async (event: any) => {
		const msgs: any[] = event.messages;
		if (!task) {
			const u = msgs.find((m) => m.role === "user");
			task = u ? textOf(u.content) : "";
		}
		// tool call id -> call; assistant turn numbers
		const calls = new Map<string, any>();
		const turnOf: number[] = [];
		let turn = 0;
		msgs.forEach((m, i) => {
			if (m.role === "assistant") {
				turn++;
				for (const b of m.content ?? []) if (b.type === "toolCall") calls.set(b.id, { ...b, turn });
			}
			turnOf[i] = turn;
		});
		const nTurns = turn;
		const items: Item[] = [];
		msgs.forEach((m, i) => {
			if (m.role === "toolResult") {
				const c = calls.get(m.toolCallId);
				const t = textOf(m.content);
				const tr = c?.turn ?? turnOf[i];
				if (t.length >= MIN_ITEM && tr <= nTurns - KEEP_TURNS)
					items.push({ key: m.toolCallId, idx: i, turn: tr, label: callLabel(c), text: t, kind: "tool" });
			} else if (m.role === "assistant" && turnOf[i] <= nTurns - KEEP_TURNS) {
				const t = (m.content ?? []).filter((b: any) => b.type === "text" || b.type === "thinking")
					.map((b: any) => b.text ?? b.thinking ?? "").join("\n");
				if (t.length >= MIN_ITEM) items.push({ key: `a:${m.timestamp ?? i}`, idx: i, turn: turnOf[i], label: `the agent's own notes in turn ${turnOf[i]}`, text: t, kind: "assistant" });
			}
		});
		const open = items.filter((it) => !applied.has(it.key));
		const totalChars = msgs.reduce((a, m) => a + msgChars(m), 0) + task.length;
		const estTokens = totalChars / CHARS_PER_TOKEN + 6000; // + system prompt and tools
		const last = msgs[msgs.length - 1];
		const due = open.length > 0 && last?.role === "toolResult" && nTurns - lastCheckTurn >= CHECK_TURNS;
		// the check runs in the background: its edits apply from the next request on, so the agent
		// never waits for the decision model
		if (due && !running) {
			lastCheckTurn = nTurns;
			running = check(msgs, open, nTurns, estTokens, calls)
				.catch((e: any) => log({ kind: "error", where: "check", error: String(e?.message ?? e) }))
				.finally(() => (running = undefined));
		}
		if (applied.size === 0) return;
		let edited = 0;
		const out = msgs.map((m, i) => {
			if (m.role === "toolResult" && applied.has(m.toolCallId)) {
				edited++;
				return { ...m, content: [{ type: "text", text: applied.get(m.toolCallId)!.replacement }] };
			}
			if (m.role === "assistant") {
				const k = `a:${m.timestamp ?? i}`;
				const a = applied.get(k);
				if (a) {
					edited++;
					const calls = (m.content ?? []).filter((b: any) => b.type === "toolCall");
					return { ...m, content: [{ type: "text", text: a.replacement }, ...calls] };
				}
			}
			return m;
		});
		return { messages: out };
	});

	function progress(msgs: any[], calls: Map<string, any>): string {
		const steps: string[] = [];
		let lastThought = "";
		for (const m of msgs) {
			if (m.role !== "assistant") continue;
			for (const b of m.content ?? []) {
				if (b.type === "toolCall") steps.push(callLabel(b));
				if (b.type === "text" && b.text.trim()) lastThought = b.text;
				if (b.type === "thinking" && (b.thinking ?? "").trim()) lastThought = b.thinking;
			}
		}
		const recent = steps.slice(-8).map((s) => `- ${s}`).join("\n");
		return `Its most recent steps (newest last):\n${recent}\n\nIts latest reasoning:\n${short(lastThought, 700)}`;
	}

	async function check(msgs: any[], open: Item[], nTurns: number, estTokens: number, calls: Map<string, any>) {
		const t0 = performance.now();
		const header = `A coding agent is working on this task:\n${short(task, 1400)}\n\n${progress(msgs, calls)}\n\n`;
		let ms = 0;
		let calls_n = 0;
		// d3 runs each question as its own full pass over the state (non-causal attention, no shared
		// prefix), so a joint call costs n_questions x state: ask each item with only its own excerpt
		const b = await systemOne(header, {
			boundary: {
				type: "noul",
				instructions: "Has the agent just finished one subtask (a bug fixed and checked, a file or module completely updated, an investigation concluded) and is it now moving on to a different part of the task?",
				criteria: {
					true: "the latest steps close one subtask or start a new, different one",
					false: "the agent is still in the middle of the same subtask, or has not started working yet",
				},
			},
		});
		ms += b.ms;
		calls_n++;
		const boundary: number | undefined = b.answers.boundary?.noul;
		log({ kind: "decide", what: "boundary", ms: Math.round(b.ms), usage: b.usage, state_chars: header.length, boundary });
		const decisions = new Map<string, { d: Decision; p: Record<string, number> }>();
		for (const it of open) {
			const state = header + `One earlier output still in its context, ${it.label} (from turn ${it.turn} of ${nTurns}, ${it.text.length} chars):\n${excerpt(it.text)}`;
			const r = await systemOne(state.slice(0, STATE_BUDGET), {
				item: {
					type: "choice",
					instructions: `For the agent's current and remaining work, what should happen to this output (${it.label})?`,
					criteria: {
						keep: "it is still needed in full: it is about the file, error or problem the agent is working on now or will work on next",
						summarise: "only a few of its lines still matter (an error message, a path, a test result, a value)",
						drop: "no longer needed: superseded by a newer read or run, about a subtask that is finished, or irrelevant noise",
					},
				},
			});
			ms += r.ms;
			calls_n++;
			const a = r.answers.item;
			if (a?.choice) decisions.set(it.key, { d: a.choice as Decision, p: a.probabilities ?? {} });
			log({ kind: "decide", what: "item", key: it.key, label: it.label, turn: it.turn, chars: it.text.length, item_kind: it.kind,
				choice: a?.choice, p: a?.probabilities, ms: Math.round(r.ms), usage: r.usage, state_chars: state.length });
		}
		const atBoundary = (boundary ?? 0) >= 0.5;
		const pressure = estTokens >= PRESSURE;
		const toApply = open.filter((it) => {
			const d = decisions.get(it.key)?.d;
			return d === "drop" || d === "summarise";
		});
		const saving = toApply.reduce((a, it) => a + it.text.length, 0);
		const apply = (atBoundary || pressure) && saving >= MIN_SAVE;
		log({ kind: "check", turn: nTurns, est_tokens: Math.round(estTokens), boundary, at_boundary: atBoundary, pressure,
			candidates: open.length, to_apply: toApply.length, saving_chars: saving, applied: apply, d3_ms: Math.round(ms), d3_calls: calls_n });
		if (!apply) return;
		// pins for every item that loses text, then apply
		for (const it of toApply) {
			const d = decisions.get(it.key)!.d;
			const cands = keyLines(it.text);
			let pins: string[] = [];
			if (cands.length) {
				// a short state: every pin question is a full pass over it
				const state = `A coding agent is working on this task:\n${short(task, 700)}\n\n` +
					`One earlier output, ${it.label} (${it.text.length} chars), is about to be removed from its context. Candidate lines to keep:\n` +
					cands.map((l, k) => `(${k + 1}) ${l}`).join("\n");
				const qs: Record<string, any> = {};
				cands.forEach((l, k) => {
					qs[`pin${k + 1}`] = {
						type: "noul",
						instructions: `Will the agent need line (${k + 1}) later to finish the task: a file path, an error message, a failing test, a value or a decision it must not forget?`,
						criteria: { true: "it will need this line later", false: "it will not need this line again" },
					};
				});
				try {
					const r = await systemOne(state.slice(0, STATE_BUDGET), qs);
					ms += r.ms;
					calls_n++;
					const ps = cands.map((_, k) => r.answers[`pin${k + 1}`]?.noul ?? 0);
					pins = cands.filter((_, k) => ps[k] >= 0.5);
					log({ kind: "pin", key: it.key, label: it.label, ms: Math.round(r.ms), candidates: cands.map((l, k) => ({ line: l, p: ps[k] })) });
				} catch (e: any) {
					log({ kind: "error", where: "pin", key: it.key, error: String(e?.message ?? e) });
					pins = cands.slice(0, 4);
				}
			}
			const pinBlock = pins.length ? `\nPinned notes:\n${pins.map((l) => `- ${l}`).join("\n")}` : "";
			const what = it.kind === "tool" ? `output of \`${it.label}\`` : it.label;
			const replacement = d === "drop"
				? `[d3-context: ${what} (${it.text.length} chars) was removed from the context as no longer needed. Re-run the tool if you need it again.]${pinBlock}`
				: `[d3-context: ${what} (${it.text.length} chars) was shortened to its key lines. Re-run the tool for the full text.]\n${summarise(it.text)}${pinBlock}`;
			applied.set(it.key, { decision: d, replacement });
		}
		log({ kind: "apply", turn: nTurns, reason: atBoundary ? "boundary" : "pressure", items: toApply.map((it) => ({ key: it.key, label: it.label, decision: decisions.get(it.key)!.d })),
			saved_chars: saving, total_applied: applied.size, d3_ms: Math.round(ms), d3_calls: calls_n, wall_ms: Math.round(performance.now() - t0) });
	}
}
