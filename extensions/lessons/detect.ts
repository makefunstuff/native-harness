// Detects "something failed and was then fixed" from the session's own tool results: a shell
// command that exited non-zero, followed later by a successful run of the same command (or, for
// checks such as tests, type checks, linters and builds, of any check). Searches that exit 1 for
// "no match" (grep, find, test …) are not failures. Pure state machine, no pi.

export interface Fix {
	failed: string; // the command that failed
	error: string; // a short excerpt of its output
	fixedBy: string; // the later command that passed
}

const SEARCH = /^(grep|rg|ag|find|fd|ls|cat|head|tail|test|\[|which|command|type|diff|cmp|git (diff|status|log|show|grep)|stat|file|pgrep|wc)\b/;
const CHECK = /\b(test|tests|spec|vitest|jest|mocha|ava|tap|pytest|tsc|typecheck|type-check|lint|eslint|biome|check|build|cargo|go (test|vet|build)|make|node --test|deno test|bun test)\b/;

// The command without what does not change its meaning: leading `cd x &&`, env assignments,
// `timeout N`, trailing `2>&1`, `| tail …` / `| head …` / `| grep …` filters, extra spaces.
export function commandKey(command: string): string {
	let c = command.trim();
	c = c.replace(/^(cd\s+\S+\s*(&&|;)\s*)+/, "");
	c = c.replace(/^((\w+=\S*)\s+)+/, "");
	c = c.replace(/^timeout\s+\S+\s+/, "");
	c = c.replace(/\s*(\|\s*(tail|head|grep|cat|less|tee)\b[^|]*)+$/, "");
	c = c.replace(/\s*2>&1\s*/g, " ");
	return c.replace(/\s+/g, " ").trim();
}

export function isCheck(command: string): boolean {
	return CHECK.test(commandKey(command));
}

export function isSearch(command: string): boolean {
	return SEARCH.test(commandKey(command));
}

// The lines of a failure worth keeping: assertion and error lines first, else the last lines.
export function errorExcerpt(output: string, max = 300): string {
	const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
	const hot = lines.filter((l) => /(error|fail|assert|expected|exception|cannot|not found|undefined|✖|not ok)/i.test(l) && !/^#\s*(fail|pass)\s+\d+/i.test(l));
	const pick = (hot.length ? hot : lines.slice(-4)).slice(0, 4).join(" | ");
	return pick.length <= max ? pick : `${pick.slice(0, max - 1)}…`;
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
		const failed = exitCode !== undefined ? exitCode !== 0 : isError;
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
