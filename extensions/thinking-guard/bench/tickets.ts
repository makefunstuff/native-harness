// Benchmark tickets: tasks/<name>/{issue.md, repo/, ref/, hidden.test.ts}. The model works in a
// copy of repo/; the hidden test is then copied next to its files and run with node's test runner.
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TASKS = join(dirname(fileURLToPath(import.meta.url)), "tasks");

export const PREAMBLE =
	"You are working autonomously in this repository; nobody will answer questions. " +
	"Read the code, make the change, run the tests, and stop when the work is done.\n\n";

export function ticketNames(): string[] {
	return readdirSync(TASKS).filter((t) => existsSync(join(TASKS, t, "issue.md"))).sort();
}

export function ticketPrompt(name: string): string {
	return PREAMBLE + readFileSync(join(TASKS, name, "issue.md"), "utf8");
}

// node --test inside node --test reports to the parent run and always exits 0: start it clean
function graderEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env.NODE_TEST_CONTEXT;
	return env;
}

export function gradeTicket(name: string, work: string, timeoutMs = 120_000): Promise<{ passed: boolean; output: string }> {
	copyFileSync(join(TASKS, name, "hidden.test.ts"), join(work, "hidden.test.ts"));
	return new Promise((ok) => {
		execFile(process.execPath, ["--test", "hidden.test.ts"], { cwd: work, timeout: timeoutMs, env: graderEnv() }, (err, stdout, stderr) => {
			ok({ passed: !err, output: (stdout + stderr).slice(-1500) });
		});
	});
}
