#!/usr/bin/env node
// lessons benchmark: pi, driven in-process through its SDK (createAgentSession), works each
// sequence of related tickets in order, with and without the extension; hidden tests grade every
// ticket, and the session's own test output says which house-rule mistakes it made on the way.
//
//   node bench/run.ts ARM --model PROVIDER/ID[:thinking] [--rounds N] [--first-round K]
//                         [--sequences a,b] [--timeout SECONDS] [--limit N] [--out NAME]
//
//   ARM  base          no extension
//        lessons       the extension as owners run it: Hindsight (a fresh bank per sequence and
//                      round, deleted afterwards) + Jev deciding what applies
//        lessons-file  the fallback: local file and plain-text matching, no classifier
//
// Each arm runs on a fresh copy of ~/.pi/agent (PI_AGENT_SRC; sessions and backups left out), so
// the real config is never touched: the user's settings, models, credentials and global
// extensions (homelab-tools gives the Jev classifier), plus codemode and tool search as the CLI
// loads them. Runs are sequential and clean up their work trees.
//
// Writes results/<ARM>.jsonl (one row per ticket; resumable: a finished sequence/round is skipped,
// a half-finished one is rerun from its first ticket, because later tickets depend on its lessons).
// Sessions, diffs and final libraries go to ~/.cache/pi-extras/lessons/ (full prompts and output).
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	createAgentSession,
	createCodemodeExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { hindsightKey, lessons, readConfig } from "../index.ts";
import { type Ticket, hidden, prepare, prompt, sequences, tickets, trapsHit, visible } from "./tickets.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const RESULTS = join(HERE, "results");
const CACHE = process.env.LESSONS_BENCH_CACHE ?? join(homedir(), ".cache", "pi-extras", "lessons");
const ARMS = ["base", "lessons", "lessons-file"];

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

// ---- Hindsight bank per sequence and round ---------------------------------------------------

const HS_URL = (process.env.HINDSIGHT_URL ?? "http://127.0.0.1:18888").replace(/\/+$/, "");
function hsHeaders(): Record<string, string> {
	const key = hindsightKey(readConfig().hindsight.keyFile);
	return { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}
async function bank(method: "PUT" | "DELETE", id: string): Promise<void> {
	const res = await fetch(`${HS_URL}/v1/default/banks/${encodeURIComponent(id)}`, {
		method,
		headers: hsHeaders(),
		body: method === "PUT" ? JSON.stringify({ name: id }) : undefined,
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok && !(method === "DELETE" && res.status === 404)) throw new Error(`Hindsight ${method} bank ${id}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

// ---- one session -------------------------------------------------------------------------------

const textOf = (c: any) => (typeof c === "string" ? c : (c ?? []).map((p: any) => p?.text ?? "").join(""));

export function sessionStats(entries: any[]) {
	const st = {
		assistant_turns: 0,
		tool_calls: 0,
		tool_errors: 0,
		input_tokens: 0,
		cache_read_tokens: 0,
		output_tokens: 0,
		cost: 0,
		lessons_shown: 0,
		lessons_text: "" as string,
		recall: null as any,
		asked: false,
		ask_input: 0, // the request answering the lesson request: new prompt tokens …
		ask_cache_read: 0, // … tokens served from the prompt cache …
		ask_output: 0, // … and the answer
		reply: null as any,
		stop: null as string | null,
	};
	let afterAsk = false;
	for (const e of entries) {
		const m = e.type === "message" ? e.message : undefined;
		if (e.type === "custom" && e.customType === "lessons") {
			if (e.data?.reply) st.reply = e.data;
			else if (e.data?.source) st.recall = e.data;
		}
		// the recalled lessons (appended after the prompt) and the end-of-run lesson request are both
		// custom messages; the request carries details.ask
		const cm = e.type === "custom_message" ? e : m?.role === "custom" ? m : undefined;
		if (cm?.customType === "lessons" && cm.details?.ask) {
			st.asked = true;
			afterAsk = true;
		} else if (cm?.customType === "lessons" && cm.details?.source) {
			st.lessons_shown = cm.details?.shown?.length ?? 0;
			st.lessons_text = textOf(cm.content);
			st.recall = cm.details;
		}
		if (m?.role === "assistant") {
			st.assistant_turns++;
			const u = m.usage ?? {};
			st.input_tokens += u.input ?? 0;
			st.cache_read_tokens += u.cacheRead ?? 0;
			st.output_tokens += u.output ?? 0;
			st.cost += u.cost?.total ?? 0;
			st.stop = m.stopReason ?? null;
			st.tool_calls += (m.content ?? []).filter((c: any) => c?.type === "toolCall").length;
			if (afterAsk) {
				st.ask_input += u.input ?? 0;
				st.ask_cache_read += u.cacheRead ?? 0;
				st.ask_output += u.output ?? 0;
				afterAsk = false;
			}
		} else if (m?.role === "toolResult" && m.isError) st.tool_errors++;
	}
	st.cost = Math.round(st.cost * 1e6) / 1e6;
	return st;
}

// Output of every bash call the agent made (where the house-rule failures show up).
function bashOutputs(entries: any[]): string[] {
	return entries
		.filter((e) => e.type === "message" && e.message?.role === "toolResult" && e.message.toolName === "bash")
		.map((e) => textOf(e.message.content));
}

interface RunOpts {
	arm: string;
	agentDir: string;
	model: string;
	timeoutS: number;
	lessonsDir: string;
	bank?: string;
}

async function runOne(o: RunOpts, t: Ticket, round: number) {
	const run = `${t.seq}-r${round}-${t.name}`;
	const work = join(CACHE, "work", o.arm, run);
	const sessDir = join(CACHE, "sessions", o.arm, run);
	const logs = join(CACHE, "logs", o.arm);
	rmSync(sessDir, { recursive: true, force: true });
	mkdirSync(sessDir, { recursive: true });
	mkdirSync(logs, { recursive: true });
	prepare(t, work);

	const [ref, thinking] = o.model.split(":");
	const slash = ref.indexOf("/");
	const modelRuntime = await ModelRuntime.create({ authPath: join(o.agentDir, "auth.json"), modelsPath: join(o.agentDir, "models.json") });
	const model = modelRuntime.getModel(ref.slice(0, slash), ref.slice(slash + 1));
	if (!model) throw new Error(`unknown model ${ref}`);
	const settingsManager = SettingsManager.create(work, o.agentDir);
	settingsManager.setProjectTrusted(true);
	const extensionFactories: any[] = [createCodemodeExtension(), createToolSearchExtension()];
	if (o.arm !== "base") {
		const base = readConfig({ ...process.env, PI_CODING_AGENT_DIR: o.agentDir });
		const cfg =
			o.arm === "lessons"
				? { ...base, dir: o.lessonsDir, store: "hindsight" as const, judge: "auto", hindsight: { ...base.hindsight, url: HS_URL, bank: o.bank! } }
				: { ...base, dir: o.lessonsDir, store: "file" as const, judge: "off" };
		extensionFactories.push((pi: any) => lessons(pi, cfg));
	}
	const resourceLoader = new DefaultResourceLoader({ cwd: work, agentDir: o.agentDir, settingsManager, extensionFactories });
	await resourceLoader.reload();
	const sessionManager = SessionManager.create(work, sessDir);
	const { session } = await createAgentSession({
		cwd: work,
		agentDir: o.agentDir,
		modelRuntime,
		model,
		thinkingLevel: thinking as any,
		settingsManager,
		resourceLoader,
		sessionManager,
	});
	const notes: string[] = [];
	const t0 = Date.now();
	let timedOut = false;
	let error: string | undefined;
	const timer = setTimeout(() => {
		timedOut = true;
		void session.abort();
	}, o.timeoutS * 1000);
	try {
		// headless: keep the extension's notifications (fallbacks, what it stored), ignore the rest
		const uiContext = new Proxy({ notify: (m: string) => void notes.push(m) } as any, {
			get: (o, k) => (k in o ? o[k] : k === "then" ? undefined : () => undefined),
		});
		await session.bindExtensions({ uiContext });
		await session.prompt(prompt(t));
	} catch (e) {
		error = String((e as Error)?.message ?? e);
	} finally {
		clearTimeout(timer);
	}
	const wall = (Date.now() - t0) / 1000;
	const entries = sessionManager.getEntries() as any[];
	const st = sessionStats(entries);
	const outputs = bashOutputs(entries);
	session.dispose();

	spawnSync("git", ["-C", work, "add", "-A"]);
	writeFileSync(join(logs, `${run}.diff`), spawnSync("git", ["-C", work, "diff", "--cached"], { encoding: "utf8" }).stdout ?? "");
	const vis = visible(work);
	const hid = hidden(t, work);
	const traps = trapsHit(t, outputs, hid);
	rmSync(work, { recursive: true, force: true });
	const scrub = (s: string) => s.replaceAll(work, ".").replaceAll(homedir(), "~");
	return {
		arm: o.arm,
		model: o.model,
		seq: t.seq,
		ticket: t.name,
		pos: t.pos,
		round,
		passed: hid.ok,
		visible_ok: vis.ok,
		hidden_failed: hid.failed,
		traps_possible: t.traps,
		traps_seen: traps.visible, // hit during the session (its own test runs)
		traps_left: traps.hidden, // still in the final tree
		mistakes: [...new Set([...traps.visible, ...traps.hidden])],
		wall_s: Math.round(wall * 10) / 10,
		timed_out: timedOut,
		error: error ?? null,
		...st,
		lessons_text: scrub(st.lessons_text),
		notes: notes.map(scrub),
	};
}

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			model: { type: "string" },
			rounds: { type: "string", default: "1" },
			"first-round": { type: "string", default: "1" },
			sequences: { type: "string", default: "" },
			timeout: { type: "string", default: "900" },
			limit: { type: "string", default: "0" }, // tickets per sequence (0 = all), for trial runs
			out: { type: "string", default: "" }, // results file name (default: the arm)
		},
	});
	const arm = positionals[0];
	if (!ARMS.includes(arm) || !values.model) throw new Error(`usage: run.ts ${ARMS.join("|")} --model PROVIDER/ID[:thinking] [--rounds N] …`);
	mkdirSync(RESULTS, { recursive: true });
	process.env.TMPDIR = join(CACHE, "tmp");
	mkdirSync(process.env.TMPDIR, { recursive: true });
	const out = join(RESULTS, `${values.out || arm}.jsonl`);
	const rows = existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
	const agentDir = agentCopy(arm);
	const seqs = values.sequences ? values.sequences.split(",") : sequences();
	const first = Number(values["first-round"]);
	for (let round = first; round < first + Number(values.rounds); round++) {
		for (const seq of seqs) {
			const list = Number(values.limit) > 0 ? tickets(seq).slice(0, Number(values.limit)) : tickets(seq);
			const done = rows.filter((r) => r.seq === seq && r.round === round && r.model === values.model);
			if (done.length >= list.length) continue;
			if (done.length) {
				// a half-finished sequence: its lessons are gone, so drop its rows and rerun it whole
				const keep = rows.filter((r) => !(r.seq === seq && r.round === round && r.model === values.model));
				writeFileSync(out, keep.map((r) => JSON.stringify(r)).join("\n") + (keep.length ? "\n" : ""));
				rows.splice(0, rows.length, ...keep);
			}
			const lessonsDir = join(CACHE, "library", arm, `${seq}-r${round}`);
			rmSync(lessonsDir, { recursive: true, force: true });
			const bankId = arm === "lessons" ? `pi-extras-lessons-bench-${seq}-r${round}-${Date.now().toString(36)}` : undefined;
			// Hindsight trouble must not stop the run: the extension falls back to its local copy and
			// says so in its notifications, which every row keeps.
			let bankError: string | undefined;
			if (bankId) await bank("PUT", bankId).catch((e) => void (bankError = String(e?.message ?? e).slice(0, 300)));
			if (bankError) console.error(`warning: ${bankError}`);
			try {
				for (const t of list) {
					const r = await runOne({ arm, agentDir, model: values.model, timeoutS: Number(values.timeout), lessonsDir, bank: bankId }, t, round);
					if (bankError) (r as any).hindsight_bank_error = bankError;
					appendFileSync(out, JSON.stringify(r) + "\n");
					rows.push(r);
					console.log(
						`${arm} ${seq} r${round} ${t.name} ${r.passed ? "PASS" : "FAIL"} ${r.wall_s}s mistakes=[${r.mistakes}] ` +
							`shown=${r.lessons_shown} asked=${r.asked ? "y" : "n"} turns=${r.assistant_turns}${r.timed_out ? " TIMEOUT" : ""}${r.error ? ` ERROR ${r.error}` : ""}`,
					);
				}
			} finally {
				if (bankId) await bank("DELETE", bankId).catch((e) => console.error(String(e)));
				// keep the final library for inspection, then drop the work copy
				const logs = join(CACHE, "logs", arm);
				mkdirSync(logs, { recursive: true });
				if (existsSync(lessonsDir)) cpSync(lessonsDir, join(logs, `library-${seq}-r${round}`), { recursive: true });
				rmSync(lessonsDir, { recursive: true, force: true });
			}
		}
	}
	rmSync(process.env.TMPDIR, { recursive: true, force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
