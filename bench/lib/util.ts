// Small shared pieces of the bench: command-line options, row files, numbers, git.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** TMPDIR on disk (not the shared /tmp tmpfs, which is small): every bench run uses this. */
export function useTmpDir(cacheDir: string): string {
	const tmp = join(cacheDir, "tmp");
	mkdirSync(tmp, { recursive: true });
	process.env.TMPDIR = tmp;
	return tmp;
}

/** Terminal-integration hooks in the user's extensions must not report bench runs as the caller. */
export function stripTerminalEnv() {
	for (const k of Object.keys(process.env)) if (/^(HERDR|ORCA)_/.test(k)) delete process.env[k];
}

/** `--name value` / `--name=value`; undefined when absent. */
export function opt(name: string, def?: string): string | undefined {
	const argv = process.argv.slice(2);
	const i = argv.indexOf(`--${name}`);
	if (i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) return argv[i + 1];
	const eq = argv.findIndex((a) => a.startsWith(`--${name}=`));
	if (eq >= 0) return argv[eq].slice(name.length + 3);
	return def;
}

export function flag(name: string): boolean {
	return process.argv.slice(2).includes(`--${name}`);
}

export function positional(): string[] {
	// an option's value is not a positional; a `--flag` has no value, so the word after one is read
	// as a value — pass positional arguments before the options
	const out: string[] = [];
	for (let i = 2; i < process.argv.length; i++) {
		const a = process.argv[i];
		if (a.startsWith("--")) {
			if (!a.includes("=") && process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith("--")) i++;
			continue;
		}
		out.push(a);
	}
	return out;
}

export function mean(xs: number[]): number {
	const v = xs.filter((x) => typeof x === "number" && !Number.isNaN(x));
	return v.length ? v.reduce((a, b) => a + b, 0) / v.length : Number.NaN;
}

export function median(xs: number[]): number {
	const v = xs.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b);
	if (!v.length) return Number.NaN;
	const mid = Math.floor(v.length / 2);
	return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function sum(xs: number[]): number {
	return xs.reduce((a, b) => a + (b || 0), 0);
}

/** Number for a table: `–` for NaN, fixed decimals otherwise. */
export function fmt(v: number | undefined | null, nd = 1): string {
	if (v === undefined || v === null) return "–";
	const x = Number(v);
	if (!Number.isFinite(x)) return "–";
	return x.toLocaleString("en-US", { minimumFractionDigits: nd, maximumFractionDigits: nd });
}

export function pct(v: number, nd = 0): string {
	return Number.isFinite(v) ? `${(100 * v).toFixed(nd)}%` : "–";
}

/** A markdown table; `header[0]` is the row-label column. */
export function table(header: string[], rows: string[][]): string[] {
	return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)];
}

/**
 * One row per line, appended as it is produced: the file may be replaced (a checkout, a rerun)
 * while a series goes on, so the target is opened per row.
 */
export function appendRow(path: string, row: object) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(row)}\n`, { flag: "a" });
}

export function readRows(path: string): any[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export function writeRows(path: string, rows: any[]) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

/** Rows whose (task, round) pair is already in the file: a series resumes after them. */
/** Which runs a row file already holds: an arm, a task and a round identify one run. */
export function doneKeys(rows: any[]): Set<string> {
	return new Set(rows.map((r) => `${r.arm}#${r.task}#${r.round}`));
}

export function git(args: string[], cwd: string): string {
	const r = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${(r.stderr ?? "").trim()}`);
	return r.stdout ?? "";
}

/** The starting tree of a work dir as one git commit. */
export function commitAll(work: string, message = "init") {
	git(["init", "-q"], work);
	git(["add", "-A"], work);
	git(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm", message], work);
}

/** `--stat` one-liner plus the full diff of the work tree against its init commit. */
export function diffOf(work: string): string {
	git(["add", "-A"], work);
	const stat = git(["diff", "--cached", "--stat"], work).trim().split("\n").pop() ?? "";
	const body = git(["diff", "--cached"], work);
	return `${stat}\n${body}`;
}

/** Rebuild a tree from a repo + a saved diff (regrade). Returns false when the diff does not apply. */
export function applyDiff(work: string, diffText: string): boolean {
	const body = diffText.slice(diffText.indexOf("diff --git"));
	const r = spawnSync("git", ["apply", "--whitespace=nowarn", "-"], { cwd: work, input: body, encoding: "utf8" });
	return r.status === 0;
}

export function cacheDirFor(name: string): string {
	return process.env.PI_EXTRAS_CACHE ?? join(homedir(), ".cache", "pi-extras", name);
}
