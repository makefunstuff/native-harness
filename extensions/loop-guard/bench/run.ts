#!/usr/bin/env node
// Before/after benchmark for loop-guard, driving pi in-process through its SDK (createAgentSession).
// Every ticket runs twice per round: arm "base" without loop-guard, arm "guard" with it (as an
// inline extension); the arms alternate which goes first. Hidden tests grade the final tree.
//
//   node extensions/loop-guard/bench/run.ts --model PROVIDER/ID [--thinking medium] [--label NAME]
//        [--rounds N] [--set all|regular|traps] [--tasks a,b] [--arms base,guard] [--timeout-min 30]
//        [--inject retry-read,retry-bash,retry-edit,stall]
//
// --inject runs the injection experiment instead of plain tickets. The tickets rarely make a model
// retry blindly, so a plain run says little about what the guard does when it fires. Here the
// session talks to a proxy (in this process) that plays a scripted opening for the first requests,
// a tool call that fails sent twice unchanged, or an answer that stops on "Let me …" with no tool
// call, and forwards every later request to the real provider. pi runs the scripted calls for
// real, so the failures are real tool results, and in the guard arm loop-guard adds its note or
// nudge as it would in a live session. Then the model takes over.
//
// The pi config is a copy of ~/.pi/agent (lib.ts agentCopy). Rows go to bench/results/<label>.jsonl
// (resumable; runs cut short by a provider error are run again); sessions and work trees stay
// under ~/.cache/pi-extras/loop-guard/.
import { createServer } from "node:http";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import loopGuard from "../index.ts";
import { agentCopy, appendRow, arg, CACHE, grade, guardCounts, readRows, seed, sessionMessages, type Ticket, tickets } from "./lib.ts";
import { replay, sessionFiles } from "./replay.ts";

// runs inside this process: never report them as the calling agent's state (herdr, orca hooks)
for (const k of Object.keys(process.env)) if (/^(HERDR|ORCA)_/.test(k)) delete process.env[k];

type Step = { tool: [string, Record<string, unknown>] } | { text: string };
const EDIT = { oldText: "\t\ttimeout: 60,\n\t\tretries: 3,", newText: "\t\ttimeout: 120,\n\t\tretries: 5," };
export const SCENARIOS: Record<string, { ticket: string; script: Step[] }> = {
	// the issue names a path that does not exist
	"retry-read": { ticket: "stale-paths", script: Array(2).fill({ tool: ["read", { path: "src/billing/invoice.ts" }] }) },
	// the test script has no exec bit
	"retry-bash": { ticket: "no-exec", script: Array(2).fill({ tool: ["bash", { command: "./run_tests.sh" }] }) },
	// the replaced text appears twice in the file
	"retry-edit": { ticket: "twin-blocks", script: Array(2).fill({ tool: ["edit", { path: "deploy/envs.ts", edits: [EDIT] }] }) },
	// one real look around, then an answer that announces the work and stops
	stall: { ticket: "logstats", script: [{ tool: ["bash", { command: "ls -R" }] }, { text: "The parser is in logstats/parser.ts. Let me read it and fix both bugs." }] },
};

function sse(n: number, step: Step): string {
	const base = { id: `chatcmpl-inject-${n}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "inject" };
	const chunk = (delta: object, finish: string | null = null, extra = {}) =>
		`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
	let out = chunk({ role: "assistant" });
	// a short reasoning text, as a thinking model writes one (some APIs require it on every turn)
	out += chunk({ reasoning_content: "Following the issue, this is the next step." });
	if ("text" in step) out += chunk({ content: step.text });
	else out += chunk({ tool_calls: [{ index: 0, id: `call_inject_${n}`, type: "function", function: { name: step.tool[0], arguments: JSON.stringify(step.tool[1]) } }] });
	out += chunk({}, "text" in step ? "stop" : "tool_calls", { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
	return `${out}data: [DONE]\n\n`;
}

/** Scripted answers for the first requests after reset(), the real upstream after that. */
async function startProxy(upstream: string) {
	let script: Step[] = [];
	let n = 0;
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		const i = n++;
		if (i < script.length) {
			res.writeHead(200, { "content-type": "text/event-stream" }).end(sse(i, script[i]));
			return;
		}
		const headers: Record<string, string> = {};
		for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && /^(authorization|content-type|accept|user-agent|x-)/i.test(k)) headers[k] = v;
		try {
			const r = await fetch(upstream + req.url, { method: "POST", headers, body: Buffer.concat(chunks) });
			res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
			if (r.body) for await (const c of r.body as any) res.write(c);
			res.end();
		} catch (e) {
			if (!res.headersSent) res.writeHead(502);
			res.end(String(e)); // pi gave up on this request, or the upstream failed: pi retries or ends the run
		}
	});
	await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
	const url = `http://127.0.0.1:${(server.address() as any).port}`;
	return { url, reset: (s: Step[]) => ((script = s), (n = 0)), close: () => server.close() };
}

/** In the agent copy: provider "inject" = the given provider with its base URL on the proxy. */
function addInjectProvider(agentDir: string, provider: string, proxyUrl: string): string {
	const mp = join(agentDir, "models.json");
	const models = JSON.parse(readFileSync(mp, "utf8"));
	const src = models.providers[provider];
	if (!src) throw new Error(`provider ${provider} not in models.json`);
	// pi infers some request details from a provider's URL; behind the proxy it cannot
	const injectModels = (src.models ?? []).map((m: any) => ({
		...m,
		compat: { supportsDeveloperRole: false, ...(m.reasoning ? { reasoningContentField: "reasoning_content" } : {}), ...(m.compat ?? {}) },
	}));
	models.providers.inject = { ...src, baseUrl: proxyUrl, models: injectModels };
	writeFileSync(mp, JSON.stringify(models, null, 2));
	const ap = join(agentDir, "auth.json");
	try {
		const auth = JSON.parse(readFileSync(ap, "utf8"));
		if (auth[provider]) {
			auth.inject = auth[provider];
			writeFileSync(ap, JSON.stringify(auth, null, 2));
		}
	} catch {}
	return String(src.baseUrl).replace(/\/+$/, "");
}

/** What the model did after a scripted opening. */
function afterInjection(msgs: any[], script: Step[]) {
	const own = msgs.filter((m) => m.role === "assistant").slice(script.length);
	const last = script.at(-1)!;
	const calls = own.flatMap((m) => (m.content ?? []).filter((c: any) => c?.type === "toolCall"));
	const same = (c: any) => "tool" in last && c.name === last.tool[0] && JSON.stringify(c.arguments) === JSON.stringify(last.tool[1]);
	return { model_turns: own.length, model_calls: calls.length, first_call_repeats: calls.length > 0 && same(calls[0]), repeats_total: calls.filter(same).length };
}

async function main() {
	const modelArg = arg("model");
	if (!modelArg) throw new Error("--model PROVIDER/ID is required");
	const [provider, ...rest] = modelArg.split("/");
	const modelId = rest.join("/");
	const inject = arg("inject")?.split(",").filter(Boolean);
	const label = arg("label") ?? `${inject ? "inject-" : ""}${modelArg.replace(/[^A-Za-z0-9.-]+/g, "_")}`;
	const thinking = arg("thinking") as any;
	const rounds = Number(arg("rounds", "1"));
	const arms = arg("arms", "base,guard")!.split(",");
	const timeoutMs = Number(arg("timeout-min", "30")) * 60_000;
	const agentDir = agentCopy(label);
	const proxy = inject ? await startProxy(addInjectProvider(agentDir, provider, "http://127.0.0.1:1")) : undefined;
	if (proxy) addInjectProvider(agentDir, provider, proxy.url);
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
	const model = modelRuntime.getModel(inject ? "inject" : provider, modelId);
	if (!model) throw new Error(`model ${modelArg} not found`);

	type Job = { key: string; ticket: Ticket; script?: Step[] };
	const all = tickets((arg("set", "all") as any) ?? "all");
	const want = arg("tasks")?.split(",");
	const jobs: Job[] = inject
		? inject.map((sc) => ({ key: sc, ticket: all.find((t) => t.name === SCENARIOS[sc].ticket) ?? tickets().find((t) => t.name === SCENARIOS[sc].ticket)!, script: SCENARIOS[sc].script }))
		: all.filter((t) => !want || want.includes(t.name)).map((t) => ({ key: t.name, ticket: t }));
	const done = new Set(readRows(label).filter((r) => !r.provider_error).map((r) => `${r.arm}/${r.key}/${r.round}`));

	for (let rnd = 1; rnd <= rounds; rnd++)
		for (const [i, job] of jobs.entries())
			for (const arm of (i + rnd) % 2 === 0 ? arms : [...arms].reverse()) {
				if (done.has(`${arm}/${job.key}/${rnd}`)) continue;
				const name = `${job.key}-r${rnd}`;
				const work = join(CACHE, "work", label, arm, name);
				const sessDir = join(CACHE, "sessions", label, arm, name);
				seed(job.ticket, work);
				rmSync(sessDir, { recursive: true, force: true });
				proxy?.reset(job.script ?? []);
				const loader = new DefaultResourceLoader({ cwd: work, agentDir, extensionFactories: arm === "guard" ? [{ name: "loop-guard", factory: loopGuard }] : [] });
				await loader.reload();
				const { session } = await createAgentSession({
					cwd: work,
					agentDir,
					modelRuntime,
					model,
					thinkingLevel: thinking,
					resourceLoader: loader,
					settingsManager: SettingsManager.create(work, agentDir),
					sessionManager: SessionManager.create(work, sessDir),
				});
				await session.bindExtensions({});
				const t0 = Date.now();
				let timedOut = false;
				const timer = setTimeout(() => ((timedOut = true), void session.abort()), timeoutMs);
				let error = "";
				try {
					await session.prompt(job.ticket.prompt);
				} catch (e) {
					error = String((e as Error)?.message ?? e).slice(0, 300);
				} finally {
					clearTimeout(timer);
					session.dispose();
				}
				const wall_s = Math.round((Date.now() - t0) / 100) / 10;
				const g = grade(job.ticket, work);
				const msgs = sessionMessages(sessDir);
				const st = replay(sessionFiles([sessDir]), false).local;
				const row = {
					label, model: modelArg, arm, key: job.key, task: job.ticket.name, round: rnd, passed: g.passed, wall_s, timed_out: timedOut, error,
					turns: st.turns, calls: st.calls, errors: st.errors, exactRetry: st.exactRetry, retry: st.retry, repeat: st.repeat, streak: st.streak, finals: st.finals, stall: st.stall,
					...guardCounts(msgs),
					...(job.script ? afterInjection(msgs, job.script) : {}),
					grade_tail: g.passed ? "" : g.tail.slice(-300),
				};
				appendRow(label, row);
				console.log(`${label} ${arm.padEnd(5)} ${name} ${g.passed ? "PASS" : "FAIL"} ${wall_s}s turns=${st.turns} calls=${st.calls} err=${st.errors} exact=${st.exactRetry} ` +
					`notes=${row.note_retry}/${row.note_repeat}/${row.note_streak} nudges=${row.nudge_stall}` +
					`${job.script ? ` first_repeat=${(row as any).first_call_repeats} repeats=${(row as any).repeats_total} model_turns=${(row as any).model_turns}` : ""}` +
					`${row.provider_error ? " PROVIDER-ERROR" : ""}${timedOut ? " TIMEOUT" : ""}`);
			}
	proxy?.close();
}

await main();
process.exit(0);
