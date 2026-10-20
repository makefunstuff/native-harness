// Ticket layout shared by every pi-extras bench that grades a work tree with hidden tests.
//
// A ticket is a folder holding:
//   issue.md          the prompt (the bench prepends the "work autonomously" preamble)
//   repo/             the starting tree, with its own tests under tests/
//   hidden.test.ts    the grader: run with node's test runner from the work tree, never shown to the agent
//   ref/              files of a correct fix, overlaid on a copy of repo/ (used only by the self-test)
//
// Ticket repos are TypeScript with "type": "module" in their package.json, so node's type stripping
// runs their tests directly. selftest() is what CI runs: the broken repo must fail the hidden tests,
// and repo + ref must pass both the hidden and the visible tests.
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll } from "./util.ts";

export const PREAMBLE =
	"You are working autonomously in this repository; nobody will answer questions. " +
	"Read the code, make the change, run the tests, and stop when the work is done.\n\n";

export interface Ticket {
	name: string;
	dir: string;
	issue: string;
	repo: string;
	/** A correct fix, overlaid on a copy of repo/ — the self-test's and an analysis script's reference. */
	ref: string;
	hidden: string;
	/** Every file of repo ∪ ref, by relative path. */
	files: string[];
	prompt: string;
}

function walk(dir: string, prefix = ""): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const rel = prefix ? `${prefix}/${e.name}` : e.name;
		if (e.isDirectory()) out.push(...walk(join(dir, e.name), rel));
		else out.push(rel);
	}
	return out;
}

export function ticketNames(root: string): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root).filter((n) => existsSync(join(root, n, "issue.md"))).sort();
}

export function loadTicket(root: string, name: string): Ticket {
	const dir = join(root, name);
	const repo = join(dir, "repo");
	const ref = join(dir, "ref");
	return {
		name,
		dir,
		repo,
		ref,
		issue: join(dir, "issue.md"),
		hidden: join(dir, "hidden.test.ts"),
		files: [...new Set([...walk(repo), ...walk(ref)])].sort(),
		prompt: PREAMBLE + readFileSync(join(dir, "issue.md"), "utf8"),
	};
}

export function loadTickets(root: string, only?: string[]): Ticket[] {
	const names = only?.length ? only : ticketNames(root);
	return names.map((n) => loadTicket(root, n));
}

/** A fresh work tree for a ticket (optionally with the reference fix on top), committed as one git commit. */
export function seed(t: Ticket, work: string, withRef = false) {
	rmSync(work, { recursive: true, force: true });
	mkdirSync(work, { recursive: true });
	cpSync(t.repo, work, { recursive: true });
	if (withRef && existsSync(t.ref)) cpSync(t.ref, work, { recursive: true });
	commitAll(work);
}

function runNodeTest(work: string, files: string[], timeoutMs: number): { ok: boolean; tail: string } {
	// spawned by the test runner (CI's self-test), the child inherits the runner's context and
	// node --test would skip running the files: the grading run must start clean
	const env = { ...process.env };
	delete env.NODE_TEST_CONTEXT;
	const r = spawnSync(process.execPath, ["--test", "--test-reporter=dot", ...files], { cwd: work, encoding: "utf8", timeout: timeoutMs, env });
	return { ok: r.status === 0, tail: `${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-1200) };
}

/** The ticket's hidden tests on a work tree (the file is copied in, then removed again). */
export function grade(t: Ticket, work: string, timeoutMs = 300_000): { ok: boolean; tail: string } {
	const dest = join(work, "hidden.test.ts");
	copyFileSync(t.hidden, dest);
	const r = runNodeTest(work, ["hidden.test.ts"], timeoutMs);
	rmSync(dest, { force: true });
	return r;
}

/** The work tree's own tests (tests/*.test.ts, tests/*.spec.ts): true when there are none. */
export function ownTests(work: string, timeoutMs = 300_000): { ok: boolean; tail: string } {
	const dir = join(work, "tests");
	if (!existsSync(dir)) return { ok: true, tail: "" };
	const files = readdirSync(dir).filter((f) => /\.(test|spec)\.ts$/.test(f)).map((f) => join("tests", f));
	if (!files.length) return { ok: true, tail: "" };
	return runNodeTest(work, files, timeoutMs);
}

export interface SelfTestRow {
	name: string;
	broken_hidden: "fail" | "PASS";
	ref_hidden: "PASS" | "FAIL";
	ref_visible: "PASS" | "FAIL";
	broken_visible: "PASS" | "FAIL";
	tail: string;
}

/** One ticket: the broken tree must fail the hidden tests, repo + ref must pass hidden and visible. */
export function selftest(t: Ticket, workRoot = process.env.TMPDIR || tmpdir()): SelfTestRow {
	const work = join(workRoot, `pi-extras-selftest-${t.name}-${process.pid}`);
	try {
		seed(t, work);
		const brokenHidden = grade(t, work);
		const brokenVisible = ownTests(work);
		seed(t, work, true);
		const refHidden = grade(t, work);
		const refVisible = ownTests(work);
		return {
			name: t.name,
			broken_hidden: brokenHidden.ok ? "PASS" : "fail",
			broken_visible: brokenVisible.ok ? "PASS" : "FAIL",
			ref_hidden: refHidden.ok ? "PASS" : "FAIL",
			ref_visible: refVisible.ok ? "PASS" : "FAIL",
			tail: refHidden.ok ? "" : refHidden.tail,
		};
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

/**
 * Self-test every ticket of a root; prints one line per ticket and returns the bad ones
 * (a ticket is bad when the broken tree passes, the reference fails, or the reference's visible tests fail).
 */
export function selftestAll(root: string, log: (line: string) => void = console.log, workRoot?: string): SelfTestRow[] {
	const rows = loadTickets(root).map((t) => selftest(t, workRoot));
	for (const r of rows) {
		log(`${r.name} broken-hidden=${r.broken_hidden} ref-hidden=${r.ref_hidden} ref-visible=${r.ref_visible}`);
		if (r.tail) log(r.tail.split("\n").slice(-12).join("\n"));
	}
	return rows.filter((r) => r.broken_hidden === "PASS" || r.ref_hidden === "FAIL" || r.ref_visible === "FAIL");
}
