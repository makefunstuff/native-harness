#!/usr/bin/env node
// thinking-guard benchmark: pi, driven in-process through its SDK (createAgentSession) with a copy
// of the human's config, works the tickets in tasks/ with or without the extension; the tickets'
// hidden tests grade the final tree.
//
//   node run.ts ARM --model PROVIDER/ID [--guard on|off] [--set key=value ...] [--rounds N]
//               [--first-round N] [--tasks a,b] [--timeout SECONDS]
//   node run.ts --report [ARM ...]      with ARMs: only the ticket/round pairs all of them have
//
// --guard on loads extensions/thinking-guard the way pi loads any extension file; --set k=v sets
// PI_THINKING_GUARD_K (e.g. --set budget=off, --set scope=all). Each arm gets its own copy of
// ~/.pi/agent (no sessions) in ~/.cache/pi-extras/thinking-guard; models on a private network are
// reached through a logging proxy that records llama-server's timings per request (prompt tokens
// processed and reused, tokens generated), so prompt-cache reuse can be checked. One row per run
// goes to results/<ARM>.jsonl (resumable: finished ticket/round pairs are skipped). Sessions stay in
// the cache folder, outside the repo.
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isPrivateHost } from "../guard.ts";
import { gradeTicket, ticketNames, ticketPrompt, TASKS } from "./tickets.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION = join(HERE, "..", "index.ts");
const RESULTS = join(HERE, "results");
const CACHE = join(homedir(), ".cache", "pi-extras", "thinking-guard");
const LONG = 8000; // a "long" thinking turn, in characters

// ---------------------------------------------------------------------------- logging proxy

interface ProxyRecord {
	t: number;
	n_messages: number;
	budget: number | null;
	reasoning_chars: number;
	client_gone: boolean;
	timings: { prompt_n?: number; cache_n?: number; predicted_n?: number } | null;
	total_ms?: number;
}

/** Pass-through proxy to an OpenAI-compatible server; one record per chat request. Paths are
 *  forwarded unchanged, so a base URL is moved behind it with reroute(). */
class Proxy {
	log: string | undefined;
	origin = "";
	private upstream: URL;
	private server = createServer((req, res) => void this.forward(req, res));
	constructor(upstream: string) {
		this.upstream = new URL(upstream);
	}
	async start() {
		await new Promise<void>((ok) => this.server.listen(0, "127.0.0.1", ok));
		this.origin = `http://127.0.0.1:${(this.server.address() as any).port}`;
	}
	reroute(url: string): string {
		return url.startsWith(this.upstream.origin) ? this.origin + url.slice(this.upstream.origin.length) : url;
	}
	private async forward(req: IncomingMessage, res: ServerResponse) {
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		const body = Buffer.concat(chunks);
		let payload: any;
		if (req.url?.endsWith("/chat/completions") && body.length) {
			try {
				payload = JSON.parse(body.toString());
			} catch {}
		}
		const rec: ProxyRecord = {
			t: Date.now(),
			n_messages: payload?.messages?.length ?? 0,
			budget: payload?.thinking_budget_tokens ?? null,
			reasoning_chars: 0,
			client_gone: false,
			timings: null,
		};
		const headers = { ...req.headers, host: this.upstream.host, "content-length": String(body.length) };
		delete headers["transfer-encoding"];
		const send = this.upstream.protocol === "https:" ? httpsRequest : httpRequest;
		const up = send(new URL(req.url ?? "/", this.upstream.origin), { method: req.method, headers }, (ur) => {
			res.writeHead(ur.statusCode ?? 502, ur.headers);
			let buf = "";
			ur.on("data", (chunk: Buffer) => {
				if (payload) {
					buf += chunk.toString();
					let nl: number;
					while ((nl = buf.indexOf("\n")) >= 0) {
						const line = buf.slice(0, nl).trim();
						buf = buf.slice(nl + 1);
						if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
						try {
							const d = JSON.parse(line.slice(6));
							rec.reasoning_chars += d.choices?.[0]?.delta?.reasoning_content?.length ?? 0;
							if (d.timings) rec.timings = { prompt_n: d.timings.prompt_n, cache_n: d.timings.cache_n, predicted_n: d.timings.predicted_n };
						} catch {}
					}
				}
				res.write(chunk);
			});
			ur.on("end", () => {
				res.end();
				this.record(payload, rec);
			});
		});
		res.on("close", () => {
			if (!res.writableFinished) {
				rec.client_gone = true; // pi aborted the request
				up.destroy();
				this.record(payload, rec);
			}
		});
		up.on("error", () => {
			if (!res.headersSent) res.writeHead(502);
			res.end();
		});
		up.end(body);
	}
	private record(payload: unknown, rec: ProxyRecord) {
		if (!payload || !this.log || rec.total_ms !== undefined) return;
		rec.total_ms = Date.now() - rec.t;
		appendFileSync(this.log, JSON.stringify(rec) + "\n");
	}
	close() {
		this.server.closeAllConnections();
		this.server.close();
	}
}

const isPrivateUrl = (url: string) => {
	try {
		return isPrivateHost(new URL(url).hostname);
	} catch {
		return false;
	}
};

// ---------------------------------------------------------------------------- agent config copy

const readJson = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {});
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2));

/** A copy of ~/.pi/agent for this arm; a private-network provider is moved behind a proxy
 *  (models.json, pi's model store, and the provider's env in auth.json may each hold the URL). */
async function agentDir(arm: string, provider: string): Promise<{ dir: string; proxy?: Proxy }> {
	const src = process.env.PI_THINKING_GUARD_BENCH_SOURCE ?? join(homedir(), ".pi", "agent");
	const dir = join(CACHE, "agent", arm);
	rmSync(dir, { recursive: true, force: true });
	cpSync(src, dir, {
		recursive: true,
		verbatimSymlinks: true,
		filter: (p) => {
			const rel = p.slice(src.length).replace(/^\/+/, "");
			const base = basename(p);
			return !(rel === "sessions" || rel.startsWith("sessions/") || base.endsWith("~") || base.includes(".pre-") || base.includes(".bak"));
		},
	});
	mkdirSync(join(dir, "sessions"), { recursive: true });
	const settings = readJson(join(dir, "settings.json"));
	const ours = (p: any) => /pi-extras|thinking-guard/.test(typeof p === "string" ? p : (p?.source ?? ""));
	settings.packages = (settings.packages ?? []).filter((p: any) => !ours(p));
	settings.extensions = (settings.extensions ?? []).filter((p: any) => !ours(p));
	writeJson(join(dir, "settings.json"), settings);

	const models = readJson(join(dir, "models.json"));
	const store = readJson(join(dir, "models-store.json"));
	const auth = readJson(join(dir, "auth.json"));
	const prov = models.providers?.[provider] ?? {};
	const stored: any[] = store[provider]?.models ?? [];
	const base = prov.baseUrl ?? stored.find((m) => m.baseUrl)?.baseUrl;
	if (!base || !isPrivateUrl(base)) return { dir };
	const proxy = new Proxy(base);
	await proxy.start();
	if (prov.baseUrl) prov.baseUrl = proxy.reroute(prov.baseUrl);
	for (const m of stored) if (m.baseUrl) m.baseUrl = proxy.reroute(m.baseUrl);
	const env = auth[provider]?.env;
	if (env && typeof env === "object") for (const k of Object.keys(env)) if (typeof env[k] === "string") env[k] = proxy.reroute(env[k]);
	writeJson(join(dir, "models.json"), models);
	if (Object.keys(store).length) writeJson(join(dir, "models-store.json"), store);
	if (Object.keys(auth).length) {
		writeJson(join(dir, "auth.json"), auth);
		chmodSync(join(dir, "auth.json"), 0o600);
	}
	return { dir, proxy };
}

// ---------------------------------------------------------------------------- stats

const pct = (xs: number[], q: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};

function sessionStats(file: string | undefined) {
	const st = {
		assistant_turns: 0, thinking: [] as number[], aborted_turns: 0, guard_entries: [] as any[], notes: 0,
		tool_calls: 0, tool_errors: 0, edit_errors: 0, output_tokens: 0, provider_errors: 0, error: null as string | null,
	};
	if (!file || !existsSync(file)) return st;
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.trim()) continue;
		const d = JSON.parse(line);
		if (d.type === "custom" && d.customType === "thinking-guard") st.guard_entries.push(d.data ?? {});
		const m = d.message ?? {};
		if (m.role === "custom" && m.customType === "thinking-guard") st.notes++;
		if (m.role === "assistant") {
			const content: any[] = m.content ?? [];
			st.assistant_turns++;
			st.thinking.push(content.filter((c) => c.type === "thinking").reduce((n, c) => n + (c.thinking?.length ?? 0), 0));
			st.output_tokens += m.usage?.output ?? 0;
			st.aborted_turns += m.stopReason === "aborted" ? 1 : 0;
			st.tool_calls += content.filter((c) => c.type === "toolCall").length;
			if (m.stopReason === "error") {
				st.provider_errors++;
				st.error = String(m.errorMessage ?? "").slice(0, 200);
			}
		} else if (m.role === "toolResult" && m.isError) {
			st.tool_errors++;
			if (m.toolName === "edit") st.edit_errors++;
		}
	}
	return st;
}

function proxyStats(file: string) {
	const s = { requests: 0, prompt_processed: 0, prompt_reused: 0, generated: 0, budget_requests: 0, aborted_requests: 0, reissue_processed: [] as number[], reissue_reused: [] as number[] };
	if (!existsSync(file)) return s;
	let afterAbort = false;
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.trim()) continue;
		const r: ProxyRecord = JSON.parse(line);
		s.requests++;
		if (r.budget !== null) s.budget_requests++;
		const t = r.timings ?? {};
		s.prompt_processed += t.prompt_n ?? 0;
		s.prompt_reused += t.cache_n ?? 0;
		s.generated += t.predicted_n ?? 0;
		if (afterAbort && r.timings) {
			s.reissue_processed.push(t.prompt_n ?? 0);
			s.reissue_reused.push(t.cache_n ?? 0);
		}
		afterAbort = r.client_gone;
		if (r.client_gone) s.aborted_requests++;
	}
	return s;
}

// ---------------------------------------------------------------------------- one run

interface Options {
	model: string;
	guard: "on" | "off";
	set: string[];
	timeoutS: number;
}

async function runTicket(arm: string, opts: Options, task: string, round: number, adir: string, proxy?: Proxy) {
	const run = `${task}-r${round}`;
	const work = join(CACHE, "work", arm, run);
	rmSync(work, { recursive: true, force: true });
	cpSync(join(TASKS, task, "repo"), work, { recursive: true });
	const git = (...a: string[]) => execFileSync("git", a, { cwd: work, stdio: "ignore" });
	git("init", "-q");
	git("add", "-A");
	git("-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm", "init");
	const sessDir = join(CACHE, "sessions", arm, run);
	rmSync(sessDir, { recursive: true, force: true });
	mkdirSync(sessDir, { recursive: true });
	const metrics = join(CACHE, "metrics", arm, `${run}.jsonl`);
	mkdirSync(dirname(metrics), { recursive: true });
	rmSync(metrics, { force: true });
	if (proxy) proxy.log = metrics;

	// the extension reads its settings when it loads, i.e. when the session is created
	for (const k of Object.keys(process.env)) if (k.startsWith("PI_THINKING_GUARD_")) delete process.env[k];
	process.env.PI_THINKING_GUARD_CONFIG = join(adir, "thinking-guard.json"); // defaults unless the arm writes one
	for (const kv of opts.set) {
		const i = kv.indexOf("=");
		process.env[`PI_THINKING_GUARD_${kv.slice(0, i).toUpperCase()}`] = kv.slice(i + 1);
	}

	const resourceLoader = new DefaultResourceLoader({
		cwd: work,
		agentDir: adir,
		additionalExtensionPaths: opts.guard === "on" ? [EXTENSION] : [],
		disabledBuiltinExtensions: ["mcp"],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({ cwd: work, agentDir: adir, resourceLoader, sessionManager: SessionManager.create(work, sessDir) });
	const [provider, ...rest] = opts.model.split("/");
	const model = session.modelRuntime.getModel(provider, rest.join("/"));
	if (!model) throw new Error(`no model ${opts.model}`);
	await session.setModel(model);
	await session.bindExtensions({ mode: "print", onError: (e: any) => console.error(`extension error (${e.extensionPath}): ${e.error}`) } as any);

	const t0 = Date.now();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		void session.abort();
	}, opts.timeoutS * 1000);
	try {
		await session.prompt(ticketPrompt(task));
		await session.waitForIdle();
	} catch (e) {
		console.error(`${run}: ${(e as Error).message}`);
	} finally {
		clearTimeout(timer);
	}
	const wall = Math.round((Date.now() - t0) / 100) / 10;
	const sessionFile = session.sessionManager.getSessionFile();
	session.dispose();
	const graded = await gradeTicket(task, work);
	const st = sessionStats(sessionFile);
	const ps = proxyStats(metrics);
	const { thinking, ...rest2 } = st;
	rmSync(work, { recursive: true, force: true });
	return {
		arm, model: opts.model, guard: opts.guard, set: opts.set, task, round, passed: graded.passed, wall_s: wall, timed_out: timedOut,
		thinking_chars: thinking, thinking_max: Math.max(0, ...thinking), thinking_p50: pct(thinking, 0.5), thinking_p90: pct(thinking, 0.9),
		long_turns: thinking.filter((x) => x > LONG).length, ...rest2,
		guard_aborts: st.guard_entries.filter((g) => g.kind === "abort").length,
		budget_hits: st.guard_entries.filter((g) => g.kind === "budget").length,
		...ps, hidden_tail: graded.output.slice(-300),
	};
}

// ---------------------------------------------------------------------------- report

function report(arms: string[]) {
	let rows: any[] = [];
	if (existsSync(RESULTS))
		for (const f of readdirSync(RESULTS).filter((f) => f.endsWith(".jsonl")).sort())
			if (!arms.length || arms.includes(f.slice(0, -6)))
				rows.push(...readFileSync(join(RESULTS, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
	if (arms.length) {
		const keys = arms.map((a) => new Set(rows.filter((r) => r.arm === a).map((r) => `${r.task}#${r.round}`)));
		rows = rows.filter((r) => keys.every((k) => k.has(`${r.task}#${r.round}`)));
	}
	const by = new Map<string, any[]>();
	for (const r of rows) by.set(r.arm, [...(by.get(r.arm) ?? []), r]);
	const sum = (rs: any[], k: string) => rs.reduce((n, r) => n + (r[k] ?? 0), 0);
	const median = (xs: number[]) => pct(xs, 0.5);
	console.log("| arm | model | runs | passed | wall (median) | turns | thinking chars/turn p50 / p90 / max | turns >8k | aborted turns | guard aborts | budget stops | tool errors | output tokens |");
	console.log("|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|");
	for (const [arm, rs] of by) {
		const th = rs.flatMap((r) => r.thinking_chars);
		console.log(`| ${arm} | ${rs[0].model} | ${rs.length} | ${rs.filter((r) => r.passed).length} | ${median(rs.map((r) => r.wall_s)).toFixed(0)} s | ${sum(rs, "assistant_turns")} | ${pct(th, 0.5)} / ${pct(th, 0.9)} / ${Math.max(0, ...th)} | ${sum(rs, "long_turns")} | ${sum(rs, "aborted_turns")} | ${sum(rs, "guard_aborts")} | ${sum(rs, "budget_hits")} | ${sum(rs, "tool_errors")} | ${sum(rs, "output_tokens")} |`);
	}
	console.log();
	const tasks = [...new Set(rows.map((r) => r.task))].sort();
	console.log(`| ticket | ${[...by.keys()].join(" | ")} |`);
	console.log(`|---|${[...by.keys()].map(() => "---").join("|")}|`);
	for (const t of tasks) {
		const cells = [...by.values()].map((rs) =>
			rs.filter((r) => r.task === t).sort((a, b) => a.round - b.round)
				.map((r) => `${r.passed ? "✓" : "✗"} ${Math.round(r.wall_s)}s/${(r.thinking_max / 1000).toFixed(1)}k`).join(" ") || "-");
		console.log(`| ${t} | ${cells.join(" | ")} |`);
	}
}

// ---------------------------------------------------------------------------- main

function parseArgs(argv: string[]) {
	const out: Record<string, string | string[] | boolean> = { set: [] as string[] };
	const pos: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--report") out.report = true;
		else if (a === "--set") (out.set as string[]).push(argv[++i]);
		else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
		else pos.push(a);
	}
	return { ...out, pos } as any;
}

async function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a.report) return report(a.pos);
	if (a.pos.length !== 1 || !a.model) throw new Error("usage: run.ts ARM --model PROVIDER/ID [...] | run.ts --report [ARM ...]");
	for (const k of Object.keys(process.env)) if (/^(HERDR|ORCA)_/.test(k)) delete process.env[k]; // no status reports as the calling agent
	process.env.TMPDIR = join(CACHE, "tmp");
	mkdirSync(process.env.TMPDIR, { recursive: true });
	const arm = a.pos[0];
	const opts: Options = { model: a.model, guard: a.guard === "on" ? "on" : "off", set: a.set, timeoutS: Number(a.timeout ?? 5400) };
	const tasks: string[] = a.tasks ? a.tasks.split(",") : ticketNames();
	const rounds = Number(a.rounds ?? 1);
	const first = Number(a["first-round"] ?? 1);
	mkdirSync(RESULTS, { recursive: true });
	const out = join(RESULTS, `${arm}.jsonl`);
	const done = new Set(existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.task}#${r.round}`; }) : []);
	const { dir, proxy } = await agentDir(arm, opts.model.split("/")[0]);
	try {
		for (let round = first; round < first + rounds; round++)
			for (const task of tasks) {
				if (done.has(`${task}#${round}`)) continue;
				const r = await runTicket(arm, opts, task, round, dir, proxy);
				appendFileSync(out, JSON.stringify(r) + "\n");
				console.log(`${arm} ${task} r${round} ${r.passed ? "PASS" : "FAIL"} ${r.wall_s}s turns=${r.assistant_turns} think max=${r.thinking_max} long=${r.long_turns} aborts=${r.guard_aborts} budget=${r.budget_hits} req=${r.requests} reuse=${r.prompt_reused}/${r.prompt_reused + r.prompt_processed}${r.timed_out ? " TIMEOUT" : ""}${r.error ? ` ERROR ${r.error}` : ""}`);
			}
	} finally {
		proxy?.close();
	}
}

await main();
process.exit(0);
