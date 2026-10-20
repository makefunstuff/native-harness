// One run of a ticket, shared by every pi-extras bench:
// seed a work tree → drive pi in-process through the SDK → save the diff → grade with hidden tests.
//
// Work trees and sessions live under the bench's cache dir (a session holds the full system prompt
// and all tool output, so it is not repo data). Per-run artifacts (diff, stderr tail, per-request
// metrics, extension logs) go to the bench's results/raw/<arm>/ folder.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { agentCopy, openSession, runPrompt } from "./pi.ts";
import { sessionStats, type SessionStats } from "./session.ts";
import { appendRow, diffOf, doneKeys, readRows } from "./util.ts";
import { grade as gradeTicket, ownTests, seed, type Ticket } from "./tickets.ts";

export interface RunContext {
	arm: string;
	task: string;
	round: number;
	/** `<task>-r<round>`: the stem of every artifact of this run. */
	name: string;
	work: string;
	sessDir: string;
	outDir: string;
	tmp: string;
	/** Where a per-run log of an extension's own decisions (its metrics file) belongs. */
	metricsPath: string;
}

export interface RunHooks {
	/** Started before the agent runs; the returned function is called after it, and its fields are merged into the row. */
	start?: (ctx: RunContext) => (() => Record<string, any>) | void;
	/** Called after the agent finished, before grading. */
	after?: (ctx: RunContext) => Record<string, any>;
}

export interface RunOpts {
	arm: string;
	ticket: Ticket;
	round: number;
	/** Bench cache root: work/, sessions/, pi-agent/, tmp/ go under it. */
	cache: string;
	/** Where this arm's per-run artifacts go (results/raw/<arm>). */
	outDir: string;
	agentDir: string;
	model: string;
	extensionPaths?: string[];
	/** Fresh extension factories per run: each run's config (log path, flags) is its own. */
	extensionFactories?: (ctx: RunContext) => any[];
	/** Environment for the run; a function so each run gets its own (per-run log paths). */
	env?: (ctx: RunContext) => Record<string, string>;
	timeoutS?: number;
	/** Extra fields on every row of the arm (provider, exp, gate, …). */
	fields?: Record<string, any>;
	hooks?: RunHooks;
	/** No model call: seed, grade, report. Used by --dry-run, and by the ticket self-test. */
	dryRun?: boolean;
	agentCopyOpts?: { httpIdleTimeoutMs?: number };
}

export interface RunRow extends Partial<SessionStats> {
	arm: string;
	task: string;
	round: number;
	passed: boolean;
	visible_ok: boolean;
	self_confirmed: boolean;
	provider_error: boolean;
	wall_s: number;
	timed_out: boolean;
	agent_rc: number | null;
	error: string | null;
	diffstat: string;
	hidden_tail: string;
	dry_run?: boolean;
}

export function makeAgentDir(cache: string, arm: string, opts?: { httpIdleTimeoutMs?: number }): string {
	return agentCopy({ cache, name: arm, httpIdleTimeoutMs: opts?.httpIdleTimeoutMs });
}

/** Run one ticket for one round. Never throws for model failures: they land in the row. */
export async function runTicket(o: RunOpts): Promise<RunRow> {
	const name = `${o.ticket.name}-r${o.round}`;
	const work = join(o.cache, "work", o.arm, name);
	const sessDir = join(o.cache, "sessions", o.arm, name);
	const tmp = join(o.cache, "tmp", o.arm, name);
	const outDir = o.outDir;
	const metricsPath = join(outDir, `${name}.metrics.jsonl`);
	mkdirSync(outDir, { recursive: true });
	seed(o.ticket, work);
	rmSync(sessDir, { recursive: true, force: true });
	mkdirSync(sessDir, { recursive: true });
	rmSync(tmp, { recursive: true, force: true });
	mkdirSync(tmp, { recursive: true });
	if (existsSync(metricsPath)) rmSync(metricsPath, { force: true });

	const ctx: RunContext = { arm: o.arm, task: o.ticket.name, round: o.round, name, work, sessDir, outDir, tmp, metricsPath };
	const envSaved: Record<string, string | undefined> = {};
	for (const [k, v] of Object.entries(o.env?.(ctx) ?? {})) {
		envSaved[k] = process.env[k];
		process.env[k] = v;
	}
	process.env.TMPDIR = tmp;

	let stop: (() => Record<string, any>) | void;
	try {
		stop = o.hooks?.start?.(ctx);
		let wall = 0;
		let timedOut = false;
		let error: string | null = null;
		let entries: any[] = [];
		if (o.dryRun) {
			// no model: the seeded tree is graded as it stands
			writeFileSync(join(outDir, `${name}.stderr`), "dry run: no model call\n");
		} else {
			const opened = await openSession({
				cwd: work,
				agentDir: o.agentDir,
				model: o.model,
				sessionDir: sessDir,
				extensionPaths: o.extensionPaths,
				extensionFactories: o.extensionFactories?.(ctx),
			});
			const res = await runPrompt(opened.session, o.ticket.prompt, o.timeoutS ?? 1800);
			wall = res.wall_s;
			timedOut = res.timed_out;
			error = res.error;
			entries = opened.entries();
			opened.dispose();
		}
		const diff = diffOf(work);
		writeFileSync(join(outDir, `${name}.diff`), diff);
		const extra = { ...(o.hooks?.after?.(ctx) ?? {}), ...(typeof stop === "function" ? stop() ?? {} : {}) };
		const st = entries.length ? sessionStats(entries) : sessionStats([]);
		const hid = gradeTicket(o.ticket, work);
		const vis = ownTests(work);
		const row: RunRow = {
			arm: o.arm,
			provider: undefined as any,
			task: o.ticket.name,
			round: o.round,
			passed: hid.ok,
			visible_ok: vis.ok,
			self_confirmed: vis.ok && !hid.ok, // its own tests are green while the hidden tests are red
			provider_error: st.stop === "error" && st.out === 0 && st.tool_calls === 0,
			wall_s: wall,
			timed_out: timedOut,
			agent_rc: error ? 1 : 0,
			error,
			diffstat: diff.split("\n")[0] ?? "",
			/** Where the transcript of this run is (the cache, outside the repo); "~" for the home. */
			session_dir: sessDir.replaceAll(homedir(), "~"),
			...st,
			...extra,
			hidden_tail: hid.tail.slice(-600).replaceAll(work, ".").replaceAll(homedir(), "~"),
		};
		if (o.dryRun) row.dry_run = true;
		return { ...row, ...(o.fields ?? {}) } as RunRow;
	} finally {
		for (const [k, v] of Object.entries(envSaved)) if (v === undefined) delete process.env[k];
		else process.env[k] = v;
		rmSync(work, { recursive: true, force: true });
		rmSync(tmp, { recursive: true, force: true });
	}
}

/**
 * The whole matrix: rounds × tasks, resumable (rows already in the file are skipped), one row
 * appended per run so an interrupted series keeps what it finished.
 */
/**
 * The whole matrix: rounds × tasks, resumable (rows already in the file are skipped), one row
 * appended per run so an interrupted series keeps what it finished. Jobs run `workers` at a time
 * (arms that carry per-run state in the process environment must use 1).
 */
export async function runSeries(
	o: Omit<RunOpts, "ticket" | "round" | "outDir"> & { tickets: Ticket[]; rounds?: number; firstRound?: number; outPath: string; workers?: number; log?: (line: string) => void },
) {
	const out = o.outPath;
	// per-run artifacts (diff, stderr, metrics) sit next to the rows, in a folder named after the arm
	const outDir = join(dirname(out), basename(out, ".jsonl"));
	const done = doneKeys(readRows(out));
	const log = o.log ?? ((l: string) => console.log(l));
	const first = o.firstRound ?? 1;
	const rounds = o.rounds ?? 1;
	const jobs: { round: number; ticket: Ticket }[] = [];
	for (let round = first; round < first + rounds; round++) for (const ticket of o.tickets) if (!done.has(`${o.arm}#${ticket.name}#${round}`)) jobs.push({ round, ticket });
	const rows: RunRow[] = [];
	let next = 0;
	const worker = async () => {
		for (;;) {
			const job = jobs[next++];
			if (!job) return;
			const row = await runTicket({ ...o, outDir, ticket: job.ticket, round: job.round });
			appendRow(out, row);
			rows.push(row);
			log(
				`${o.arm} ${job.ticket.name} r${job.round} ${row.passed ? "PASS" : "FAIL"} ${row.wall_s}s turns=${row.assistant_turns ?? 0} ` +
					`calls=${row.tool_calls ?? 0} err=${row.tool_errors ?? 0}${row.timed_out ? " TIMEOUT" : ""}${row.error ? ` ERROR ${row.error}` : ""}`,
			);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, o.workers ?? 1) }, worker));
	return rows;
}
