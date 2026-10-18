#!/usr/bin/env node
// verify-gate benchmark: pi, driven in-process through its SDK (createAgentSession), works the
// TypeScript tickets in bench/tickets with and without the extension; hidden tests grade the tree.
//
//   node bench/run.ts ARM --model PROVIDER/ID[:thinking] [--gate on|off|gate-only|rule-only]
//                         [--rounds N] [--first-round K] [--tasks a,b] [--timeout SECONDS]
//
// Each arm runs on a fresh copy of ~/.pi/agent (PI_AGENT_SRC; sessions and backups left out), so
// the real config is never touched: the user's settings, models, credentials and global extensions,
// plus codemode and tool search as the CLI loads them (MCP is left out). The gate arm adds this
// checkout's verify-gate as an inline extension. Every ticket repo has `.pi/verify` = `node --test`
// in both arms (pi ignores the file without the extension), so the gate runs the agent's own tests.
//
// Writes results/<ARM>.jsonl (one row per run; resumable: finished task/round pairs are skipped).
// Sessions and diffs go to ~/.cache/pi-extras/verify-gate/ (they hold full prompts and tool output).
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	type SessionEntry,
	createAgentSession,
	createCodemodeExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { readConfig, verifyGate } from "../index.ts";
import { hidden, prepare, prompt, ticketNames, visible } from "./tickets.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const RESULTS = join(HERE, "results");
const CACHE = process.env.VERIFY_BENCH_CACHE ?? join(homedir(), ".cache", "pi-extras", "verify-gate");

// Terminal-integration hooks in the user's extensions must not report bench runs as the caller.
for (const k of Object.keys(process.env)) if (/^(HERDR|ORCA)_/.test(k)) delete process.env[k];

function agentCopy(arm: string): string {
	const src = process.env.PI_AGENT_SRC ?? join(homedir(), ".pi", "agent");
	const dest = join(CACHE, "pi-agent", arm);
	rmSync(dest, { recursive: true, force: true });
	cpSync(src, dest, {
		recursive: true,
		verbatimSymlinks: true,
		filter: (p) => {
			const rel = p.slice(src.length).replace(/^\/+/, "");
			const base = rel.split("/").pop() ?? "";
			return !(rel === "sessions" || rel.startsWith("sessions/") || base.endsWith("~") || base.includes(".pre-") || base.includes(".bak"));
		},
	});
	mkdirSync(join(dest, "sessions"), { recursive: true });
	return dest;
}

interface Stats {
	assistant_turns: number;
	tool_calls: number;
	tool_errors: number;
	edit_errors: number;
	input_tokens: number;
	cache_read_tokens: number;
	output_tokens: number;
	gate_checks: number;
	gate_failures: number;
	gate_rounds: number;
	gate_gave_up: boolean;
	after_gate_input: number; // the request right after a gate message: new prompt tokens …
	after_gate_cache_read: number; // … and tokens served from the prompt cache
	stop: string | null;
}

export function sessionStats(entries: SessionEntry[]): Stats {
	const st: Stats = {
		assistant_turns: 0, tool_calls: 0, tool_errors: 0, edit_errors: 0, input_tokens: 0, cache_read_tokens: 0, output_tokens: 0,
		gate_checks: 0, gate_failures: 0, gate_rounds: 0, gate_gave_up: false, after_gate_input: 0, after_gate_cache_read: 0, stop: null,
	};
	let afterGate = false;
	for (const e of entries as any[]) {
		if (e.type === "custom" && e.customType === "verify-gate") {
			st.gate_checks++;
			if (!e.data?.ok) st.gate_failures++;
		}
		if (e.type === "custom_message" && e.customType === "verify-gate") {
			const text = typeof e.content === "string" ? e.content : (e.content ?? []).map((c: any) => c.text ?? "").join("");
			if (text.includes("still fails")) st.gate_gave_up = true;
			else {
				st.gate_rounds++;
				afterGate = true;
			}
		}
		const m = e.type === "message" ? e.message : undefined;
		if (m?.role === "assistant") {
			st.assistant_turns++;
			const u = m.usage ?? {};
			st.input_tokens += u.input ?? 0;
			st.cache_read_tokens += u.cacheRead ?? 0;
			st.output_tokens += u.output ?? 0;
			st.stop = m.stopReason ?? null;
			st.tool_calls += (m.content ?? []).filter((c: any) => c?.type === "toolCall").length;
			if (afterGate) {
				st.after_gate_input += u.input ?? 0;
				st.after_gate_cache_read += u.cacheRead ?? 0;
				afterGate = false;
			}
		} else if (m?.role === "toolResult" && m.isError) {
			st.tool_errors++;
			if (m.toolName === "edit") st.edit_errors++;
		}
	}
	return st;
}

async function runOne(opts: { arm: string; agentDir: string; model: string; gate: string; timeoutS: number }, name: string, round: number) {
	const run = `${name}-r${round}`;
	const work = join(CACHE, "work", opts.arm, run);
	const sessDir = join(CACHE, "sessions", opts.arm, run);
	const logs = join(CACHE, "logs", opts.arm);
	rmSync(sessDir, { recursive: true, force: true });
	mkdirSync(sessDir, { recursive: true });
	mkdirSync(logs, { recursive: true });
	prepare(name, work);

	const [ref, thinking] = opts.model.split(":");
	const slash = ref.indexOf("/");
	const modelRuntime = await ModelRuntime.create({ authPath: join(opts.agentDir, "auth.json"), modelsPath: join(opts.agentDir, "models.json") });
	const model = modelRuntime.getModel(ref.slice(0, slash), ref.slice(slash + 1));
	if (!model) throw new Error(`unknown model ${ref}`);
	const settingsManager = SettingsManager.create(work, opts.agentDir);
	// The CLI trusts a folder with no protected project resources (only .pi/verify here); do the same.
	settingsManager.setProjectTrusted(true);
	const extensionFactories = [createCodemodeExtension(), createToolSearchExtension()];
	if (opts.gate !== "off") extensionFactories.push((pi) => verifyGate(pi, readConfig({ ...process.env, PI_VERIFY_GATE: opts.gate })));
	const resourceLoader = new DefaultResourceLoader({ cwd: work, agentDir: opts.agentDir, settingsManager, extensionFactories });
	await resourceLoader.reload();
	const sessionManager = SessionManager.create(work, sessDir);
	const { session } = await createAgentSession({
		cwd: work, agentDir: opts.agentDir, modelRuntime, model, thinkingLevel: thinking as any, settingsManager, resourceLoader, sessionManager,
	});
	const t0 = Date.now();
	let timedOut = false;
	let error: string | undefined;
	const timer = setTimeout(() => {
		timedOut = true;
		void session.abort();
	}, opts.timeoutS * 1000);
	try {
		await session.bindExtensions({});
		await session.prompt(prompt(name));
	} catch (e) {
		error = String((e as Error)?.message ?? e);
	} finally {
		clearTimeout(timer);
	}
	const wall = (Date.now() - t0) / 1000;
	const st = sessionStats(sessionManager.getEntries());
	session.dispose();

	spawnSync("git", ["-C", work, "add", "-A"]);
	writeFileSync(join(logs, `${run}.diff`), spawnSync("git", ["-C", work, "diff", "--cached"], { encoding: "utf8" }).stdout ?? "");
	const vis = visible(work);
	const hid = hidden(name, work);
	const tail = hid.tail.slice(-300).replaceAll(work, ".").replaceAll(homedir(), "~");
	rmSync(work, { recursive: true, force: true });
	return {
		arm: opts.arm, model: opts.model, gate: opts.gate, task: name, round, passed: hid.ok, visible_ok: vis.ok,
		self_confirmed: vis.ok && !hid.ok, // own tests green, hidden tests red
		wall_s: Math.round(wall * 10) / 10, timed_out: timedOut, error: error ?? null, ...st, hidden_tail: tail,
	};
}

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			model: { type: "string" },
			gate: { type: "string", default: "on" },
			rounds: { type: "string", default: "1" },
			"first-round": { type: "string", default: "1" },
			tasks: { type: "string", default: "" },
			timeout: { type: "string", default: "1800" },
		},
	});
	const arm = positionals[0];
	if (!arm || !values.model) throw new Error("usage: run.ts ARM --model PROVIDER/ID[:thinking] [--gate on|off|gate-only|rule-only] …");
	if (!["on", "off", "gate-only", "rule-only"].includes(values.gate!)) throw new Error(`bad --gate ${values.gate}`);
	mkdirSync(RESULTS, { recursive: true });
	process.env.TMPDIR = join(CACHE, "tmp");
	mkdirSync(process.env.TMPDIR, { recursive: true });
	const out = join(RESULTS, `${arm}.jsonl`);
	const done = new Set<string>();
	if (existsSync(out)) for (const l of readFileSync(out, "utf8").split("\n")) if (l.trim()) done.add(`${JSON.parse(l).task}#${JSON.parse(l).round}`);
	const agentDir = agentCopy(arm);
	const tasks = values.tasks ? values.tasks.split(",") : ticketNames();
	const first = Number(values["first-round"]);
	for (let round = first; round < first + Number(values.rounds); round++) {
		for (const name of tasks) {
			if (done.has(`${name}#${round}`)) continue;
			const r = await runOne({ arm, agentDir, model: values.model, gate: values.gate!, timeoutS: Number(values.timeout) }, name, round);
			appendFileSync(out, JSON.stringify(r) + "\n");
			console.log(`${arm} ${name} r${round} ${r.passed ? "PASS" : "FAIL"} ${r.wall_s}s visible=${r.visible_ok ? "ok" : "fail"} ` +
				`gate=${r.gate_checks}/${r.gate_rounds} turns=${r.assistant_turns} calls=${r.tool_calls}${r.timed_out ? " TIMEOUT" : ""}${r.error ? ` ERROR ${r.error}` : ""}`);
		}
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
