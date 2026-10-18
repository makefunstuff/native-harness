// Shared pieces of the loop-guard bench: tickets, grading, the pi config copy, session analysis.
//
// A ticket is a folder under bench/tasks/: issue.md (the prompt), repo/ (the starting tree, with
// its own tests as tests/*.spec.ts), hidden.spec.ts (the grader, run with node's test runner from
// the work tree) and ref/ (files of a correct fix, used only by selftest.ts).
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const EXT = dirname(HERE);
export const TASKS = join(HERE, "tasks");
export const RESULTS = join(HERE, "results");
export const CACHE = join(homedir(), ".cache", "pi-extras", "loop-guard");

export const PREAMBLE =
	"You are working autonomously in this repository; nobody will answer questions. " +
	"Read the code, make the change, run the tests, and stop when the work is done.\n\n";

export const TRAPS = ["no-exec", "stale-paths", "twin-blocks"];

export interface Ticket {
	name: string;
	dir: string;
	prompt: string;
}

export function tickets(set: "all" | "regular" | "traps" = "all"): Ticket[] {
	return readdirSync(TASKS)
		.filter((n) => existsSync(join(TASKS, n, "issue.md")))
		.filter((n) => set === "all" || (set === "traps") === TRAPS.includes(n))
		.sort()
		.map((name) => ({ name, dir: join(TASKS, name), prompt: PREAMBLE + readFileSync(join(TASKS, name, "issue.md"), "utf8") }));
}

/** A fresh work tree for a ticket (optionally with the reference fix on top), committed as one git commit. */
export function seed(t: Ticket, work: string, withRef = false) {
	rmSync(work, { recursive: true, force: true });
	mkdirSync(work, { recursive: true });
	cpSync(join(t.dir, "repo"), work, { recursive: true });
	if (withRef && existsSync(join(t.dir, "ref"))) cpSync(join(t.dir, "ref"), work, { recursive: true });
	const git = (...a: string[]) => execFileSync("git", a, { cwd: work, stdio: "ignore" });
	git("init", "-q");
	git("add", "-A");
	git("-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm", "init");
}

/** Run the ticket's hidden tests on a work tree. */
export function grade(t: Ticket, work: string): { passed: boolean; tail: string } {
	copyFileSync(join(t.dir, "hidden.spec.ts"), join(work, "hidden.spec.ts"));
	const r = spawnSync(process.execPath, ["--test", "--test-reporter=dot", "hidden.spec.ts"], { cwd: work, encoding: "utf8", timeout: 180_000 });
	rmSync(join(work, "hidden.spec.ts"), { force: true });
	return { passed: r.status === 0, tail: `${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-600) };
}

/** Run the work tree's own tests (tests/*.spec.ts), if it has any. */
export function ownTests(work: string): boolean {
	const dir = join(work, "tests");
	if (!existsSync(dir)) return true;
	const files = readdirSync(dir).filter((f) => f.endsWith(".spec.ts")).map((f) => join("tests", f));
	return spawnSync(process.execPath, ["--test", "--test-reporter=dot", ...files], { cwd: work, encoding: "utf8", timeout: 180_000 }).status === 0;
}

/**
 * A copy of the human's pi config (~/.pi/agent, or PI_AGENT_SRC) without sessions, so nothing in
 * the real one changes. Any install of pi-extras is dropped (the bench loads loop-guard itself),
 * and the HTTP idle timeout is raised: a shared local server can queue a request for minutes.
 */
export function agentCopy(name: string): string {
	const src = process.env.PI_AGENT_SRC ?? join(homedir(), ".pi", "agent");
	const dest = join(CACHE, `agent-${name}`);
	rmSync(dest, { recursive: true, force: true });
	mkdirSync(dest, { recursive: true });
	if (existsSync(src))
		cpSync(src, dest, {
			recursive: true,
			verbatimSymlinks: true,
			filter: (p) => {
				const rel = p.slice(src.length).replace(/^\/+/, "");
				return !(rel === "sessions" || rel.startsWith("sessions/") || rel.endsWith("~") || rel.includes(".pre-"));
			},
		});
	chmodSync(dest, 0o700);
	const sp = join(dest, "settings.json");
	const s = existsSync(sp) ? JSON.parse(readFileSync(sp, "utf8")) : {};
	const keep = (x: any) => !/pi-extras|native-harness/.test(typeof x === "string" ? x : (x?.source ?? ""));
	s.packages = (s.packages ?? []).filter(keep);
	s.extensions = (s.extensions ?? []).filter(keep);
	s.httpIdleTimeoutMs = 1_800_000;
	writeFileSync(sp, JSON.stringify(s, null, 2));
	return dest;
}

/** Messages of a session: assistant and tool-result messages in order, plus custom messages. */
export function sessionMessages(sessDir: string): any[] {
	const out: any[] = [];
	if (!existsSync(sessDir)) return out;
	for (const f of readdirSync(sessDir).filter((n) => n.endsWith(".jsonl")))
		for (const line of readFileSync(join(sessDir, f), "utf8").split("\n")) {
			if (!line) continue;
			const d = JSON.parse(line);
			if (d.type === "message" && d.message?.role) out.push(d.message);
			else if (d.type === "custom_message") out.push({ role: "custom", customType: d.customType });
		}
	return out;
}

const NOTE_RULES = { retry: "call has now failed", repeat: "You have run this exact", streak: "tool calls all failed" } as const;

/** Notes and nudges loop-guard actually added in a session, and whether it ended on a provider error. */
export function guardCounts(msgs: any[]) {
	const c = { note_retry: 0, note_repeat: 0, note_streak: 0, nudge_stall: 0, provider_error: false };
	for (const m of msgs) {
		if (m.role === "custom" && m.customType === "loop-guard") c.nudge_stall++;
		if (m.role === "toolResult") {
			const txt = (m.content ?? []).map((x: any) => x?.text ?? "").join(" ");
			if (txt.includes("[loop-guard]"))
				for (const [k, s] of Object.entries(NOTE_RULES)) if (txt.includes(s)) (c as any)[`note_${k}`]++;
		}
	}
	const last = msgs.filter((m) => m.role === "assistant").at(-1);
	c.provider_error = last?.stopReason === "error";
	return c;
}

export function appendRow(label: string, row: object) {
	mkdirSync(RESULTS, { recursive: true });
	// one append per row: the file may be replaced (a checkout) while a run goes on
	writeFileSync(join(RESULTS, `${label}.jsonl`), `${JSON.stringify(row)}\n`, { flag: "a" });
}

export function readRows(label: string): any[] {
	const p = join(RESULTS, `${label}.jsonl`);
	if (!existsSync(p)) return [];
	return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function arg(name: string, def?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : def;
}
