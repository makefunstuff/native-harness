// verify-gate logic, without pi: find the project's check command, run it, fingerprint the
// working tree, and word the message the model gets when the check fails.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Check {
	/** Shell script run with bash, or undefined when `file` is executable and run directly. */
	script?: string;
	/** An executable .pi/verify, run as is. */
	file?: string;
	/** Where it was found, for messages: ".pi/verify" or "AGENTS.md". */
	source: string;
	/** Directory the check runs in: the folder holding .pi/ or AGENTS.md. */
	root: string;
	/** One line describing the command, for messages. */
	label: string;
}

export interface CheckResult {
	ok: boolean;
	code: number | null;
	signal: string | null;
	timedOut: boolean;
	ms: number;
	output: string;
}

// The prompt rule: one line, the same in every run, so it never changes the system prompt
// between requests (prompt cache).
export const TEST_RULE =
	"Tests must not share assumptions with the code under test: derive expected values from the task or spec (or by hand), never from running or copying the implementation.";

export const EDIT_TOOLS = new Set(["edit", "write", "multiedit", "multi_edit", "apply_patch", "patch"]);

// --- finding the check -------------------------------------------------------------------------

// Folders from cwd up to the repository root (the first folder with .git). Outside a git
// repository only cwd itself: a parent folder (the home folder, say) is not this project.
export function searchDirs(cwd: string): string[] {
	const out: string[] = [];
	let dir = cwd;
	for (;;) {
		out.push(dir);
		if (existsSync(join(dir, ".git"))) return out;
		const up = dirname(dir);
		if (up === dir) return [cwd];
		dir = up;
	}
}

// The check command in an AGENTS.md, in one of three explicit forms (anything else is ignored, so
// the gate never runs a command it guessed from prose):
//   <!-- verify: make test -->
//   Verify: `make test`            (also "Check:", "Check command:", bulleted or bold; the command
//                                  must end the line, so "Check: `the docs` before …" is prose)
//   ## Verify                      (also "Check", "Checks"): the first fenced code block of that section
export function parseAgentsMd(text: string): string | undefined {
	const comment = text.match(/<!--\s*verify:\s*([\s\S]*?)\s*-->/i);
	if (comment?.[1].trim()) return comment[1].trim();
	const line = text.match(/^[ \t]*(?:[-*][ \t]+)?(?:\*\*)?(?:verify|check)(?:[ \t]+command)?(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*`([^`\n]+)`[ \t]*\.?[ \t]*$/im);
	if (line) return line[1].trim();
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const h = lines[i].match(/^(#{1,6})\s+(verify|verification|check|checks)\s*$/i);
		if (!h) continue;
		for (let j = i + 1; j < lines.length; j++) {
			const next = lines[j].match(/^(#{1,6})\s/);
			if (next && next[1].length <= h[1].length) break;
			const fence = lines[j].match(/^\s*(```|~~~)/);
			if (!fence) continue;
			const body: string[] = [];
			for (let k = j + 1; k < lines.length && !lines[k].trim().startsWith(fence[1]); k++) body.push(lines[k]);
			const script = body.join("\n").trim();
			return script || undefined;
		}
	}
	return undefined;
}

// The nearest .pi/verify or AGENTS.md with a check command, from cwd up to the repository root.
// A .pi/verify in a folder wins over that folder's AGENTS.md.
export function findCheck(cwd: string): Check | undefined {
	for (const dir of searchDirs(cwd)) {
		const verify = join(dir, ".pi", "verify");
		if (existsSync(verify) && statSync(verify).isFile()) {
			const text = readFileSync(verify, "utf8");
			const label = firstCommandLine(text) ?? ".pi/verify";
			if (isExecutable(verify)) return { file: verify, source: ".pi/verify", root: dir, label };
			if (text.trim()) return { script: text, source: ".pi/verify", root: dir, label };
			// an empty .pi/verify: fall through to this folder's AGENTS.md
		}
		const agents = join(dir, "AGENTS.md");
		if (existsSync(agents)) {
			const script = parseAgentsMd(readFileSync(agents, "utf8"));
			if (script) return { script, source: "AGENTS.md", root: dir, label: firstCommandLine(script) ?? script };
		}
	}
	return undefined;
}

function isExecutable(p: string): boolean {
	try {
		accessSync(p, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function firstCommandLine(text: string): string | undefined {
	const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
	if (!lines.length) return undefined;
	return lines.length === 1 ? lines[0] : `${lines[0]} …`;
}

// --- running it ---------------------------------------------------------------------------------

export function runCheck(check: Check, { timeoutMs = 300_000, env = {} as Record<string, string> } = {}): Promise<CheckResult> {
	const t0 = Date.now();
	const [cmd, args] = check.file ? [check.file, []] : ["bash", ["-c", check.script!]];
	return new Promise((ok) => {
		let output = "";
		let timedOut = false;
		const child = spawn(cmd, args, {
			cwd: check.root,
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
			detached: true, // own process group, so a timeout kills the whole check
		});
		const add = (d: Buffer) => {
			output += d;
			if (output.length > 4_000_000) output = output.slice(-2_000_000); // keep memory bounded
		};
		child.stdout.on("data", add);
		child.stderr.on("data", add);
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				process.kill(-child.pid!, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		}, timeoutMs);
		const done = (code: number | null, signal: string | null) => {
			clearTimeout(timer);
			ok({ ok: code === 0 && !timedOut, code, signal, timedOut, ms: Date.now() - t0, output });
		};
		child.on("error", (e) => {
			output += String(e?.message ?? e);
			done(null, null);
		});
		child.on("close", done);
	});
}

// Head and tail of a long output; test runners print the failures and the summary at the end.
export function truncate(text: string, max = 4000): string {
	if (text.length <= max) return text;
	const head = Math.floor(max * 0.2);
	const tail = max - head;
	return `${text.slice(0, head)}\n… [${text.length - max} characters cut] …\n${text.slice(-tail)}`;
}

// --- noticing changes made outside the edit tools (bash, codemode scripts) ----------------------

// Untracked build and cache output that running tests creates; not a change by the agent.
const CACHE_PATH = /(^|\/)(__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|node_modules)(\/|$)|\.pyc$/;

// A fingerprint of the working tree: HEAD, the paths git reports as changed or untracked, and
// their size and mtime. Read-only (no git objects written). Undefined outside a git repository.
export function treeFingerprint(dir: string): string | undefined {
	const git = (...a: string[]) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });
	const status = git("status", "--porcelain=v1", "-z", "--untracked-files=all");
	if (status.status !== 0) return undefined;
	const top = git("rev-parse", "--show-toplevel").stdout.trim() || dir;
	const h = createHash("sha256");
	h.update(git("rev-parse", "-q", "--verify", "HEAD").stdout.trim());
	const parts = status.stdout.split("\0");
	for (let i = 0; i < parts.length; i++) {
		const entry = parts[i];
		if (!entry) continue;
		if (entry[0] === "R" || entry[0] === "C") i++; // rename/copy: the next field is the old path
		if (entry.startsWith("??") && CACHE_PATH.test(entry.slice(3))) continue;
		h.update(entry + "\0");
		try {
			const st = statSync(join(top, entry.slice(3)));
			h.update(`${st.size}:${st.mtimeMs}\0`);
		} catch {
			h.update("gone\0");
		}
	}
	return h.digest("hex");
}

// --- the message --------------------------------------------------------------------------------

export function failureMessage(check: Check, res: CheckResult, round: number, maxRounds: number, maxOutput = 4000): string {
	const how = res.timedOut ? `timed out after ${Math.round(res.ms / 1000)} s` : `exit code ${res.code ?? res.signal}`;
	return [
		`verify-gate: the project's check fails after your changes (round ${round} of ${maxRounds}).`,
		`Command: \`${check.label}\` (from ${check.source}), ${how}, ${(res.ms / 1000).toFixed(1)} s.`,
		"Output:",
		"```",
		truncate(res.output.trimEnd(), maxOutput),
		"```",
		"Find the cause and fix it, then finish. Do not weaken, skip or delete tests to make the check pass. " +
			"If a failure is not caused by your change and you cannot fix it, say so plainly in your final answer.",
	].join("\n");
}

export function giveUpMessage(check: Check, res: CheckResult, rounds: number, maxOutput = 2000): string {
	const how = res.timedOut ? "timed out" : `exit code ${res.code ?? res.signal}`;
	return [
		`verify-gate: the check still fails after ${rounds} round${rounds === 1 ? "" : "s"} of fixes; stopping here.`,
		`Command: \`${check.label}\` (from ${check.source}), ${how}.`,
		"```",
		truncate(res.output.trimEnd(), maxOutput),
		"```",
	].join("\n");
}
