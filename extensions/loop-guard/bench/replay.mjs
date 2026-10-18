#!/usr/bin/env node
// Replay recorded pi / OMP sessions through loop-guard's rules (guard.ts), without a model:
// how often each rule would have fired, and what the model did next without the note.
//
//   node extensions/loop-guard/bench/replay.mjs DIR... [--json]
//
// DIR: session folders (searched for *.jsonl), e.g. ~/.pi/agent/sessions ~/.omp/agent/sessions.
// Assistant messages from provider "llama.cpp" (or a llama-native model) count as local, the rest
// as cloud. Per class it reports, per tool call:
//   exact retry   the call repeats the previous call (same tool, byte-identical arguments) and
//                 that call failed (the metric of the 2026-10-12 session analysis);
//   rules         how often retry / repeat / streak would have fired;
//   after retry   whether the call after a "retry" firing was the same call again (blind) or not;
// and per assistant turn:
//   stall         a run-ending message (no tool call, stop) that loop-guard's stall rule matches;
//   user nudged   of those, how many the user followed with a short "go on"-style prompt.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LoopGuard, callKey, resultText, stallIntent } from "../guard.ts";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const dirs = args.filter((a) => !a.startsWith("--"));
if (!dirs.length) {
	console.error("usage: replay.mjs DIR... [--json]");
	process.exit(2);
}

const files = [];
const walk = (d) => {
	for (const e of readdirSync(d, { withFileTypes: true })) {
		const p = join(d, e.name);
		if (e.isDirectory()) walk(p);
		else if (e.name.endsWith(".jsonl") && statSync(p).size > 0) files.push(p);
	}
};
for (const d of dirs) walk(d);

const GO_ON = /^\s*(continue|go on|go ahead|proceed|do it|keep going|carry on|yes|ok(ay)?|please do|next|and\??|well\??|\.+|\?+)\b/i;
const blank = () => ({ sessions: 0, turns: 0, calls: 0, errors: 0, exactRetry: 0, retry: 0, repeat: 0, streak: 0, afterRetrySame: 0, afterRetryOther: 0, afterRetryNone: 0, finals: 0, stall: 0, stallNudgedByUser: 0, otherFinalsNudgedByUser: 0 });
const stats = { local: blank(), cloud: blank() };

const isLocal = (m) => m.provider === "llama.cpp" || m.provider === "llama-native" || /^(llama\.cpp|llama-native)\//.test(m.model ?? "");

for (const f of files) {
	const msgs = [];
	for (const line of readFileSync(f, "utf8").split("\n")) {
		if (!line) continue;
		let d;
		try {
			d = JSON.parse(line);
		} catch {
			continue;
		}
		if (d.type === "message" && d.message?.role) msgs.push(d.message);
		else if (d.type === "custom_message") msgs.push({ role: "custom" });
	}
	if (!msgs.some((m) => m.role === "assistant")) continue;
	const guard = new LoopGuard();
	const seen = new Set();
	const callArgs = new Map();
	let cls = "cloud";
	let prevCall; // {raw, isError}
	let pendingRetry; // class of a retry firing waiting for the next call
	for (let i = 0; i < msgs.length; i++) {
		const m = msgs[i];
		if (m.role === "assistant") {
			cls = isLocal(m) ? "local" : "cloud";
			const s = stats[cls];
			if (!seen.has(cls)) {
				seen.add(cls);
				s.sessions++;
			}
			s.turns++;
			const toolCalls = (m.content ?? []).filter((c) => c?.type === "toolCall");
			for (const c of toolCalls) callArgs.set(c.id, c);
			if (!toolCalls.length && m.stopReason === "stop") {
				s.finals++;
				const next = msgs.slice(i + 1).find((x) => x.role === "user" || x.role === "assistant");
				const nudged = next?.role === "user" && resultText(next.content).length < 80 && GO_ON.test(resultText(next.content));
				if (stallIntent(resultText(m.content))) {
					s.stall++;
					s.stallNudgedByUser += nudged ? 1 : 0;
				} else s.otherFinalsNudgedByUser += nudged ? 1 : 0;
			}
			continue;
		}
		if (m.role !== "toolResult") continue;
		const s = stats[cls];
		const c = callArgs.get(m.toolCallId);
		const name = m.toolName ?? c?.name ?? "?";
		const raw = `${name} ${JSON.stringify(c?.arguments ?? {})}`;
		s.calls++;
		s.errors += m.isError ? 1 : 0;
		if (prevCall && prevCall.isError && prevCall.raw === raw) s.exactRetry++;
		if (pendingRetry) {
			pendingRetry.key === callKey(name, c?.arguments ?? {}) ? s.afterRetrySame++ : s.afterRetryOther++;
			pendingRetry = undefined;
		}
		const note = guard.onResult(name, c?.arguments ?? {}, resultText(m.content), !!m.isError);
		if (note) s[note.rule]++;
		if (note?.rule === "retry") pendingRetry = { key: callKey(name, c?.arguments ?? {}) };
		prevCall = { raw, isError: !!m.isError };
	}
	if (pendingRetry) stats[cls].afterRetryNone++;
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(2)} %` : "-");
if (asJson) {
	console.log(JSON.stringify({ files: files.length, ...stats }, null, 2));
} else {
	console.log(`${files.length} session files`);
	const rows = [
		["sessions", (s) => s.sessions],
		["assistant turns", (s) => s.turns],
		["tool calls", (s) => s.calls],
		["tool error rate", (s) => pct(s.errors, s.calls)],
		["exact retry of a failed call", (s) => `${s.exactRetry} (${pct(s.exactRetry, s.calls)})`],
		["rule retry would fire", (s) => `${s.retry} (${pct(s.retry, s.calls)})`],
		["  next call the same again", (s) => `${s.afterRetrySame} of ${s.retry}`],
		["rule repeat would fire", (s) => `${s.repeat} (${pct(s.repeat, s.calls)})`],
		["rule streak would fire", (s) => `${s.streak} (${pct(s.streak, s.calls)})`],
		["run-ending messages", (s) => s.finals],
		["stall rule would fire", (s) => `${s.stall} (${pct(s.stall, s.turns)} of turns)`],
		["  user then said 'go on'", (s) => `${s.stallNudgedByUser} of ${s.stall}`],
		["  'go on' after other endings", (s) => `${s.otherFinalsNudgedByUser} of ${s.finals - s.stall}`],
	];
	console.log(`| metric | local | cloud |\n|---|---:|---:|`);
	for (const [label, f] of rows) console.log(`| ${label} | ${f(stats.local)} | ${f(stats.cloud)} |`);
}
