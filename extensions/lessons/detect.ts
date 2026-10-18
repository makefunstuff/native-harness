// Detects "something failed and was then fixed" from the session's own tool results: a shell
// command that exited non-zero, followed later by a successful run of the same command (or, for
// checks such as tests, type checks, linters and builds, of any check). Searches that exit 1 for
// "no match" (grep, find, test …) are not failures. Pure state machine, no pi.

export interface Fix {
	failed: string; // the command that failed
	error: string; // a short excerpt of its output
	fixedBy: string; // the later command that passed
}

const SEARCH = /^(grep|rg|ag|find|fd|ls|cat|head|tail|test|\[|which|command|type|diff|cmp|git (diff|status|log|show|grep)|stat|file|pgrep|wc|echo|printf|pwd|cd|mkdir|true)\b/;
const CHECK = /\b(test|tests|spec|vitest|jest|mocha|ava|tap|pytest|tsc|typecheck|type-check|lint|eslint|biome|check|build|cargo|go (test|vet|build)|make|node --test|deno test|bun test)\b/;

// Heredoc bodies hold arbitrary text (code with && and "test" in it): drop them before parsing.
function dropHeredocs(command: string): string {
	return command.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, "<<HEREDOC");
}

// One simple command without what does not change its meaning: env assignments, `timeout N`,
// trailing `2>&1`, `| tail …` / `| head …` / `| grep …` filters, extra spaces.
function normalise(segment: string): string {
	let c = segment.trim();
	c = c.replace(/^((\w+=\S*)\s+)+/, "");
	c = c.replace(/^timeout\s+\S+\s+/, "");
	c = c.replace(/\s*(\|\s*(tail|head|grep|cat|less|tee)\b[^|]*)+$/, "");
	c = c.replace(/\s*2>&1\s*/g, " ");
	return c.replace(/\s+/g, " ").trim();
}

function segments(command: string): string[] {
	return dropHeredocs(command)
		.split(/\s*(?:&&|\|\||;|\n)\s*/)
		.map(normalise)
		.filter((s) => s && !/^cd\s/.test(s) && s !== "cd");
}

const isSearchSegment = (s: string) => SEARCH.test(s) && !/(^|\s)(>|>>|tee)\s/.test(s);

// The part of a command that decides whether it "passed": its last check (`… && npm test &&
// git status` is `npm test`), else its last command.
export function commandKey(command: string): string {
	const segs = segments(command);
	if (!segs.length) return normalise(command);
	const checks = segs.filter((s) => CHECK.test(s) && !isSearchSegment(s));
	return checks.at(-1) ?? segs.at(-1)!;
}

export function isCheck(command: string): boolean {
	return segments(command).some((s) => CHECK.test(s) && !isSearchSegment(s));
}

// Only looks, changes nothing: a non-zero exit is "no match", not a failure.
export function isSearch(command: string): boolean {
	const segs = segments(command);
	return segs.length > 0 && segs.every(isSearchSegment);
}

// The lines of a failure worth keeping: assertion, error and problem lines first (not npm's own
// "npm error" noise), else the last lines.
export function errorExcerpt(output: string, max = 300): string {
	const lines = output
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !/^npm (error|ERR!|warn)/i.test(l));
	const hot = lines.filter(
		(l) => /(error|fail|assert|expected|exception|cannot|not found|undefined|✖|not ok|problem|missing|is not|does not|has no)/i.test(l) && !/^(#\s*)?(ℹ\s*)?(fail|pass)\s+\d+/i.test(l),
	);
	const pick = (hot.length ? hot : lines.slice(-4)).slice(0, 4).join(" | ");
	return pick.length <= max ? pick : `${pick.slice(0, max - 1)}…`;
}

// A check whose output says it failed. Used when a pipe (`npm test | tail`) hides the exit code.
const FAILED_OUTPUT = [
	/^npm (error|ERR!)/m,
	/^ℹ fail [1-9]/m,
	/^# fail [1-9]/m,
	/^not ok \d+/m,
	/\b[1-9]\d* (failing|failed)\b/,
	/Tests?:\s+[1-9]\d* failed/,
	/^\S+: [1-9]\d* problems?$/m,
	/^error TS\d+:|: error TS\d+:/m,
];

export function looksFailed(output: string): boolean {
	return FAILED_OUTPUT.some((r) => r.test(output));
}

// The pipe sits outside heredoc bodies and quotes, after the check.
function pipesOutput(command: string): boolean {
	return /\|(?!\|)/.test(dropHeredocs(command).replace(/'[^']*'|"[^"]*"/g, ""));
}

export class FixTracker {
	private open = new Map<string, { command: string; error: string; check: boolean }>();
	fixes: Fix[] = [];
	failures = 0;

	reset(): void {
		this.open.clear();
		this.fixes = [];
		this.failures = 0;
	}

	// One finished bash call. `exitCode` undefined means unknown (treated like isError).
	onBash(command: string, isError: boolean, output: string, exitCode?: number): void {
		if (!command.trim() || isSearch(command)) return;
		const key = commandKey(command);
		let failed = exitCode !== undefined ? exitCode !== 0 : isError;
		if (!failed && isCheck(command) && pipesOutput(command) && looksFailed(output)) failed = true;
		if (/Command (aborted|timed out)/.test(output) && failed) return; // not a fault of the code
		if (failed) {
			this.failures++;
			if (!this.open.has(key)) this.open.set(key, { command: key, error: errorExcerpt(output), check: isCheck(command) });
			return;
		}
		const same = this.open.get(key);
		if (same) {
			this.fixes.push({ failed: same.command, error: same.error, fixedBy: key });
			this.open.delete(key);
			return;
		}
		if (isCheck(command)) {
			for (const [k, f] of this.open) {
				if (!f.check) continue;
				this.fixes.push({ failed: f.command, error: f.error, fixedBy: key });
				this.open.delete(k);
			}
		}
	}
}
