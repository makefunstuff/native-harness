// Bench tickets: bench/tickets/<name>/ holds issue.md (the prompt), repo/ (the code the agent gets),
// ref/ (files that, laid over repo/, solve the ticket; only for the self-test) and hidden.test.ts
// (the grader, never shown to the agent). All TypeScript, run by node's test runner. An optional
// `verify` file replaces the default project check (`node --test`) for that ticket.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TICKETS = join(dirname(fileURLToPath(import.meta.url)), "tickets");
export const CHECK = "node --test\n"; // the default project check, written to .pi/verify in every ticket repo

export const PREAMBLE =
	"You are working autonomously in this repository; nobody will answer questions. " +
	"Read the code, make the change, run the tests, and stop when the work is done.\n\n";
export const SUFFIX =
	"\n\nThe code is TypeScript that Node runs directly (type stripping, no build step): use only erasable " +
	"syntax (no enum, namespace or constructor parameter properties) and import local files with their .ts " +
	"extension. Run the tests with: node --test\n";

export function ticketNames(): string[] {
	return readdirSync(TICKETS, { withFileTypes: true })
		.filter((d) => d.isDirectory() && existsSync(join(TICKETS, d.name, "issue.md")))
		.map((d) => d.name)
		.sort();
}

export function prompt(name: string): string {
	return PREAMBLE + readFileSync(join(TICKETS, name, "issue.md"), "utf8").trimEnd() + SUFFIX;
}

// A fresh git repository with the ticket's code (and optionally the reference solution on top).
export function prepare(name: string, work: string, { withRef = false } = {}): void {
	rmSync(work, { recursive: true, force: true });
	mkdirSync(work, { recursive: true });
	cpSync(join(TICKETS, name, "repo"), work, { recursive: true });
	if (withRef) cpSync(join(TICKETS, name, "ref"), work, { recursive: true });
	for (const f of ["src/.gitkeep", "tests/.gitkeep"]) rmSync(join(work, f), { force: true });
	mkdirSync(join(work, ".pi"), { recursive: true });
	const own = join(TICKETS, name, "verify");
	writeFileSync(join(work, ".pi", "verify"), existsSync(own) ? readFileSync(own, "utf8") : CHECK);
	const git = (...a: string[]) => spawnSync("git", ["-C", work, ...a], { stdio: "ignore" });
	git("init", "-q");
	git("add", "-A");
	git("-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm", "init");
}

export interface Outcome {
	ok: boolean;
	tail: string;
}

function exec(work: string, cmd: string, args: string[]): Outcome {
	const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", NODE_NO_WARNINGS: "1" };
	const r = spawnSync(cmd, args, { cwd: work, env, encoding: "utf8", timeout: 180_000 });
	return { ok: r.status === 0, tail: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}`.slice(-1500) };
}

// The project's own check (.pi/verify), as the agent's repository defines it.
export function visible(work: string): Outcome {
	return exec(work, "bash", [".pi/verify"]);
}

// The hidden tests, copied in for grading only and removed again.
export function hidden(name: string, work: string): Outcome {
	const dest = join(work, "hidden.test.ts");
	cpSync(join(TICKETS, name, "hidden.test.ts"), dest);
	try {
		return exec(work, process.execPath, ["--test", "hidden.test.ts"]);
	} finally {
		rmSync(dest, { force: true });
	}
}
