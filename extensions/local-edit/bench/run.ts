// local-edit benchmark: pi works the edit-heavy tickets of bench/tasks/ through its SDK
// (createAgentSession, in-process), with pi's own edit tool (--edit base) or with local-edit
// (--edit local-edit: this checkout's extension, loaded like `pi -e`). Hidden tests grade the
// final tree with node's test runner.
//
//   node extensions/local-edit/bench/run.ts ARM --model PROVIDER/ID[:thinking] --edit base|local-edit
//        [--rounds N] [--first-round K] [--tasks a,b] [--timeout SECONDS]
//
// Per run it records the hidden-test result (which hidden tests failed: the "untouched" ones are
// the destructive-edit check) and, from the session, every edit call: errors (by kind), loose
// placements and path repairs made by local-edit, and edits that removed non-blank lines without
// putting them back (no added line resembles them; from pi's own diff, so both arms are measured the same way). It also counts
// "collateral" lines: lines the original and the reference solution share that the final tree lost.
//
// Runs on a copy of ~/.pi/agent (no sessions), refreshed per arm, so the real config is never
// touched; HERDR_* / ORCA_* variables are dropped so the config's extensions do not report to the
// work board. Rows go to results/<ARM>.jsonl, or $LOCAL_EDIT_RESULTS/<ARM>.jsonl (resumable:
// finished ticket/round pairs are skipped). Transcripts and diffs go to ~/.cache/pi-extras/local-edit/
// (outside the repo: they hold the full prompt and tool output).
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compactDiff } from "../diff.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = dirname(HERE);
const TASKS = join(HERE, "tasks");
export const RESULTS = process.env.LOCAL_EDIT_RESULTS ?? join(HERE, "results");
const CACHE = process.env.LOCAL_EDIT_BENCH_CACHE ?? join(homedir(), ".cache/pi-extras/local-edit");
const PREAMBLE =
	"You are working autonomously in this repository; nobody will answer questions. Read the code, make the change, run the tests, and stop when the work is done.\n\n";

export interface Row {
	arm: string;
	model: string;
	edit: string;
	task: string;
	round: number;
	passed: boolean;
	failed_tests: string[];
	untouched_broken: boolean;
	collateral_lines: number;
	wall_s: number;
	timed_out: boolean;
	error?: string;
	assistant_turns: number;
	tool_calls: number;
	tool_errors: number;
	edit_calls: number;
	edit_errors: number;
	edit_error_kinds: Record<string, number>;
	write_calls: number;
	tolerant_matches: number;
	path_repairs: number;
	drop_warnings: number;
	edits_dropping_3plus: number;
	dropped_lines: number;
	output_tokens: number;
	input_tokens: number;
	cache_read_tokens: number;
	stop?: string;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

function walkFiles(root: string, rel = ""): string[] {
	const out: string[] = [];
	for (const d of readdirSync(join(root, rel), { withFileTypes: true })) {
		const r = join(rel, d.name);
		if (d.isDirectory()) out.push(...walkFiles(root, r));
		else out.push(r);
	}
	return out;
}

function counter(lines: string[]): Map<string, number> {
	const m = new Map<string, number>();
	for (const l of lines.map(norm).filter(Boolean)) m.set(l, (m.get(l) ?? 0) + 1);
	return m;
}

/** Lines the original repo and the reference solution share that the final tree lost. */
export function collateral(task: string, work: string): number {
	const orig = join(TASKS, task, "repo");
	const ref = join(TASKS, task, "ref");
	let lost = 0;
	for (const rel of walkFiles(orig)) {
		if (rel.startsWith("tests") || !existsSync(join(ref, rel))) continue;
		const o = counter(readFileSync(join(orig, rel), "utf8").split("\n"));
		const r = counter(readFileSync(join(ref, rel), "utf8").split("\n"));
		const now = existsSync(join(work, rel)) ? counter(readFileSync(join(work, rel), "utf8").split("\n")) : new Map<string, number>();
		for (const [line, n] of o) {
			const keep = Math.min(n, r.get(line) ?? 0);
			lost += Math.max(0, keep - (now.get(line) ?? 0));
		}
	}
	return lost;
}

/** Non-blank lines a successful edit removed and did not put back, by local-edit's own measure (diff.ts). */
export function diffDropped(diff: string | undefined): number {
	return compactDiff(diff)?.dropped ?? 0;
}

export function classifyError(text: string): string {
	const t = text.toLowerCase();
	if (t.includes("could not find") || t.includes("was not placed")) return "not_found";
	if (t.includes("occurrences") || (t.includes("matches") && t.includes("places")) || t.includes("several places") || t.includes("of this same call")) return "ambiguous";
	if (t.includes("enoent") || t.includes("file not found") || t.includes("could not edit file")) return "path";
	if (t.includes("validation") || t.includes("invalid") || t.includes("is missing")) return "arguments";
	if (t.includes("no changes made")) return "no_change";
	if (t.includes("overlap")) return "overlap";
	return "other";
}

const textOf = (m: any) => (Array.isArray(m?.content) ? m.content.map((c: any) => (typeof c === "string" ? c : c?.text ?? "")).join(" ") : String(m?.content ?? ""));

/** Edit and tool statistics from a session's messages. */
export function sessionStats(messages: any[]) {
	const st = {
		assistant_turns: 0, tool_calls: 0, tool_errors: 0, edit_calls: 0, edit_errors: 0, edit_error_kinds: {} as Record<string, number>,
		write_calls: 0, tolerant_matches: 0, path_repairs: 0, drop_warnings: 0, edits_dropping_3plus: 0, dropped_lines: 0,
		output_tokens: 0, input_tokens: 0, cache_read_tokens: 0, stop: undefined as string | undefined,
	};
	for (const m of messages) {
		if (m?.role === "assistant") {
			st.assistant_turns++;
			st.output_tokens += m.usage?.output ?? 0;
			st.input_tokens += m.usage?.input ?? 0;
			st.cache_read_tokens += m.usage?.cacheRead ?? 0;
			st.stop = m.stopReason;
			for (const c of m.content ?? []) if (c?.type === "toolCall") st.tool_calls++;
		} else if (m?.role === "toolResult") {
			const text = textOf(m);
			if (m.toolName === "write") st.write_calls++;
			if (m.isError) st.tool_errors++;
			if (m.toolName !== "edit") continue;
			st.edit_calls++;
			if (m.isError) {
				st.edit_errors++;
				const k = classifyError(text);
				st.edit_error_kinds[k] = (st.edit_error_kinds[k] ?? 0) + 1;
				continue;
			}
			st.tolerant_matches += (text.match(/matched (lines? [\d-]+) \(|decoded literal/g) ?? []).length;
			st.path_repairs += (text.match(/path "[^"]*" (resolved to|taken as)/g) ?? []).length;
			st.drop_warnings += Number(text.includes("were removed and not re-added") || text.includes("placeholder comment"));
			const dropped = diffDropped(m.details?.diff);
			st.dropped_lines += dropped;
			st.edits_dropping_3plus += Number(dropped >= 3);
		}
	}
	return st;
}

function agentCopy(arm: string): string {
	const src = process.env.PI_AGENT_SRC ?? join(homedir(), ".pi/agent");
	const dest = join(CACHE, "pi-agent", arm);
	rmSync(dest, { recursive: true, force: true });
	cpSync(src, dest, {
		recursive: true,
		verbatimSymlinks: true,
		filter: (p) => {
			const n = relative(src, p).split("/")[0];
			return !(n === "sessions" || n.endsWith("~") || n.includes(".pre-") || n.includes(".bak"));
		},
	});
	mkdirSync(join(dest, "sessions"), { recursive: true });
	chmodSync(dest, 0o700);
	return dest;
}

function grade(task: string, work: string): { passed: boolean; failed: string[] } {
	cpSync(join(TASKS, task, "hidden.test.ts"), join(work, "hidden.test.ts"));
	const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "hidden.test.ts"], { cwd: work, encoding: "utf8", timeout: 180_000 });
	rmSync(join(work, "hidden.test.ts"), { force: true });
	const failed = [...(r.stdout ?? "").matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
	return { passed: r.status === 0, failed };
}

const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });

async function runOne(sdk: any, opts: { arm: string; model: string; edit: string; timeout: number; agentDir: string; modelRuntime: any; model_: any; thinking?: string }, task: string, round: number): Promise<Row> {
	const name = `${task}-r${round}`;
	const work = join(CACHE, "work", opts.arm, name);
	const logs = join(CACHE, "logs", opts.arm);
	rmSync(work, { recursive: true, force: true });
	mkdirSync(logs, { recursive: true });
	cpSync(join(TASKS, task, "repo"), work, { recursive: true });
	git(work, "init", "-q");
	git(work, "add", "-A");
	git(work, "commit", "-qm", "init");
	const prompt = PREAMBLE + readFileSync(join(TASKS, task, "issue.md"), "utf8");
	const resourceLoader = new sdk.DefaultResourceLoader({
		cwd: work,
		agentDir: opts.agentDir,
		additionalExtensionPaths: opts.edit === "local-edit" ? [join(EXT, "index.ts")] : [],
	});
	await resourceLoader.reload();
	const { session } = await sdk.createAgentSession({
		cwd: work,
		agentDir: opts.agentDir,
		modelRuntime: opts.modelRuntime,
		model: opts.model_,
		thinkingLevel: opts.thinking,
		resourceLoader,
		sessionManager: sdk.SessionManager.inMemory(work),
	});
	const t0 = Date.now();
	let timedOut = false;
	let error: string | undefined;
	const timer = setTimeout(() => {
		timedOut = true;
		void session.abort();
	}, opts.timeout * 1000);
	try {
		await session.prompt(prompt);
	} catch (e: any) {
		error = String(e?.message ?? e).slice(0, 300);
	} finally {
		clearTimeout(timer);
	}
	const wall = Math.round((Date.now() - t0) / 100) / 10;
	const messages = [...session.messages];
	session.dispose();
	writeFileSync(join(logs, `${name}.messages.jsonl`), messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
	git(work, "add", "-A");
	writeFileSync(join(logs, `${name}.diff`), git(work, "diff", "--cached").stdout ?? "");
	const { passed, failed } = grade(task, work);
	const row: Row = {
		arm: opts.arm, model: opts.model, edit: opts.edit, task, round, passed, failed_tests: failed,
		untouched_broken: failed.some((t) => /untouched|tabs kept/.test(t)), collateral_lines: collateral(task, work),
		wall_s: wall, timed_out: timedOut, ...(error ? { error } : {}), ...sessionStats(messages),
	};
	rmSync(work, { recursive: true, force: true });
	return row;
}

async function main() {
	const argv = process.argv.slice(2);
	const flag = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
	const arm = argv[0];
	const modelSpec = flag("--model");
	const edit = flag("--edit", "local-edit")!;
	if (!arm || arm.startsWith("--") || !modelSpec || !["base", "local-edit"].includes(edit)) {
		console.error("usage: run.ts ARM --model PROVIDER/ID[:thinking] --edit base|local-edit [--rounds N] [--first-round K] [--tasks a,b] [--timeout S]");
		process.exit(2);
	}
	const rounds = Number(flag("--rounds", "1"));
	const first = Number(flag("--first-round", "1"));
	const timeout = Number(flag("--timeout", "1800"));
	const only = flag("--tasks")?.split(",");
	for (const k of Object.keys(process.env)) if (/^(HERDR|ORCA)_/.test(k)) delete process.env[k];
	const agentDir = agentCopy(arm);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const sdk = await import("@earendil-works/pi-coding-agent");
	const [spec, thinking] = modelSpec.split(":");
	const slash = spec.indexOf("/");
	const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), modelsStorePath: join(agentDir, "models-store.json") });
	const model_ = modelRuntime.getModel(spec.slice(0, slash), spec.slice(slash + 1));
	if (!model_) throw new Error(`unknown model ${spec}`);
	mkdirSync(RESULTS, { recursive: true });
	const out = join(RESULTS, `${arm}.jsonl`);
	const done = new Set(existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.task}#${r.round}`; }) : []);
	const tasks = readdirSync(TASKS).filter((t) => !only || only.includes(t)).sort();
	for (let round = first; round < first + rounds; round++)
		for (const task of tasks) {
			if (done.has(`${task}#${round}`)) continue;
			const r = await runOne(sdk, { arm, model: modelSpec, edit, timeout, agentDir, modelRuntime, model_, thinking }, task, round);
			appendFileSync(out, JSON.stringify(r) + "\n");
			console.log(
				`${arm} ${task} r${round} ${r.passed ? "PASS" : "FAIL"} ${r.wall_s}s edits=${r.edit_calls} errors=${r.edit_errors} ${JSON.stringify(r.edit_error_kinds)} ` +
					`tolerant=${r.tolerant_matches} paths=${r.path_repairs} dropped=${r.dropped_lines} untouched_broken=${r.untouched_broken} collateral=${r.collateral_lines}` +
					`${r.timed_out ? " TIMEOUT" : ""}${r.error ? ` ERROR ${r.error}` : ""}`,
			);
		}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
