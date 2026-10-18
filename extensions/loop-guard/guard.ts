// loop-guard logic, free of pi: the extension (index.ts), its tests and the session replay
// (bench/replay.mjs) all drive this same code.
//
// Three tool-result rules, checked in this order (at most one note per result):
//   retry   the call failed exactly as an earlier call with the same arguments did
//           (same tool, same arguments after normalisation, same error after normalisation);
//   repeat  the call succeeded with the same output as identical calls before it, 3, 5, 8… times;
//   streak  the last 3, 6, 9… tool calls all failed, whatever they were.
// And one end-of-run rule:
//   stall   the run ends on an assistant message with no tool call whose last sentence announces
//           an action ("I'll run the tests.", "Let me fix that:").

export type Rule = "retry" | "repeat" | "streak" | "stall";

export interface Options {
	/** Calls kept for the retry and repeat rules. */
	window: number;
	/** Rules that are off. */
	disabled: Set<Rule>;
	/** Stall nudges per user prompt. */
	maxStallNudges: number;
}

export const DEFAULTS: Options = { window: 20, disabled: new Set(), maxStallNudges: 2 };

// PI_LOOP_GUARD: "off" turns every rule off; "-stall,-streak" turns single rules off.
export function parseOptions(env: string | undefined): Options {
	const disabled = new Set<Rule>();
	for (const part of (env ?? "").split(",").map((s) => s.trim().toLowerCase())) {
		if (part === "off" || part === "0" || part === "false") for (const r of ["retry", "repeat", "streak", "stall"] as Rule[]) disabled.add(r);
		else if (part.startsWith("-")) disabled.add(part.slice(1) as Rule);
	}
	return { ...DEFAULTS, disabled };
}

export const TAG = "[loop-guard]";

// Arguments as a stable string: keys sorted, whitespace runs in strings collapsed, so a retry that
// only re-indents or re-wraps a command counts as the same call. Bash commands also lose output
// plumbing that does not change what runs (`2>&1`, a trailing `| head -n 40` / `| tail -20`).
export function callKey(tool: string, args: unknown): string {
	const norm = (v: unknown): unknown => {
		if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
		if (Array.isArray(v)) return v.map(norm);
		if (v && typeof v === "object")
			return Object.fromEntries(
				Object.keys(v)
					.sort()
					.map((k) => [k, norm((v as Record<string, unknown>)[k])]),
			);
		return v;
	};
	let a = norm(args ?? {});
	if (tool === "bash" && a && typeof a === "object" && typeof (a as any).command === "string") {
		let cmd: string = (a as any).command;
		for (let prev = ""; prev !== cmd; ) {
			prev = cmd;
			cmd = cmd
				.replace(/\s*\|\s*(head|tail)(\s+-n)?(\s+-?\d+)?\s*$/, "")
				.replace(/\s*2>&1\s*$/, "")
				.replace(/\s+2>&1(?=\s*(\||;|&&|$))/g, "")
				.trim();
		}
		a = { ...(a as object), command: cmd };
	}
	return `${tool} ${JSON.stringify(a)}`;
}

// Output as a stable string: numbers (timings, pids, line counts) and whitespace do not count.
export function outcomeKey(text: string): string {
	return text
		.replace(/0x[0-9a-f]+/gi, "#")
		.replace(/\d+(\.\d+)?/g, "#")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 2000);
}

export function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((c: any) => (c?.type === "text" ? (c.text ?? "") : "")).join("\n");
}

// What to try instead, per tool.
function hint(tool: string): string {
	switch (tool) {
		case "edit":
			return "read the file again around the place you want to change, then copy the text to replace exactly from that fresh output (or replace a smaller, unique span)";
		case "read":
			return "check that the path exists (ls or find) before reading it again";
		case "write":
			return "check the path and that its directory exists";
		case "bash":
			return "read the error, fix its cause or use a different command";
		default:
			return "read the error and change the arguments, or use a different tool";
	}
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

interface Call {
	key: string;
	outcome: string;
	isError: boolean;
}

export interface Note {
	rule: Rule;
	text: string;
}

export class LoopGuard {
	private calls: Call[] = [];
	private failStreak = 0;
	stallNudges = 0;
	readonly fired: Record<Rule, number> = { retry: 0, repeat: 0, streak: 0, stall: 0 };
	readonly opts: Options;

	constructor(opts: Options = DEFAULTS) {
		this.opts = opts;
	}

	reset() {
		this.calls = [];
		this.failStreak = 0;
		this.stallNudges = 0;
	}

	/** A new user prompt: the stall budget starts again; the call history stays. */
	newPrompt() {
		this.stallNudges = 0;
	}

	/** Record a finished tool call; returns the note to append to its result, if any. */
	onResult(tool: string, args: unknown, output: string, isError: boolean): Note | undefined {
		const call: Call = { key: callKey(tool, args), outcome: outcomeKey(output), isError };
		const same = this.calls.filter((c) => c.key === call.key);
		const sameOutcome = same.filter((c) => c.outcome === call.outcome && c.isError === isError);
		const last = this.calls[this.calls.length - 1];
		this.calls.push(call);
		if (this.calls.length > this.opts.window) this.calls.shift();
		this.failStreak = isError ? this.failStreak + 1 : 0;
		const on = (r: Rule) => !this.opts.disabled.has(r);

		if (isError && sameOutcome.length > 0 && on("retry")) {
			const n = sameOutcome.length + 1;
			const back = last && last.key === call.key ? "The previous call was this same call and failed the same way" : "What you did since the last attempt did not change this error";
			return this.note("retry", `${TAG} This exact \`${tool}\` call has now failed ${n} times with the same error. ${back}; running it again unchanged will fail again. Change approach: ${hint(tool)}.`);
		}
		const n = sameOutcome.length + 1;
		if (!isError && same.length > 0 && sameOutcome.length === same.length && [3, 5, 8, 12].includes(n) && on("repeat")) {
			return this.note("repeat", `${TAG} You have run this exact \`${tool}\` call ${n} times and got the same output each time. Running it again will not tell you anything new: act on this output, or try something different.`);
		}
		if (isError && this.failStreak >= 3 && this.failStreak % 3 === 0 && on("streak")) {
			return this.note("streak", `${TAG} The last ${this.failStreak} tool calls all failed. Stop and rethink before the next call: check your assumptions against the actual files and errors, then take one small step you can verify.`);
		}
		return undefined;
	}

	/** The run is about to end on this assistant text with no tool call: the nudge to send, if any. */
	onFinal(text: string): Note | undefined {
		if (this.opts.disabled.has("stall") || this.stallNudges >= this.opts.maxStallNudges) return undefined;
		const intent = stallIntent(text);
		if (!intent) return undefined;
		this.stallNudges++;
		return this.note("stall", `${TAG} Your last message ends with "${intent}" but you made no tool call, so nothing happened. If there is more to do, do it now with a tool call. If the work is finished, say so plainly.`);
	}

	private note(rule: Rule, text: string): Note {
		this.fired[rule]++;
		return { rule, text };
	}
}

// Phrases that announce an action the model is about to take.
const INTENT = /\b(I'll|I will|I'm going to|I am going to|let me|let's|I need to|I should|next,? I|now I|I'm now going to|I now need to)\b/i;
const LEAD = /^(\W*\b(now|next|okay|ok|great|good|alright|all right|first|then|so|and|finally|perfect|right)\b)*\W*$/i;
// Closings that are not stalls: offers to the user, wrap-ups.
const NOT_STALL = /\b(let me know|if you('d| would)? (like|want|need)|feel free|happy to|I'll (stop|leave|wait|keep it)|I will (stop|leave|wait)|should you|would you like|let me summari[sz]e)\b/i;

/** The announced action the text ends on ("I'll run the tests"), or undefined. */
export function stallIntent(text: string): string | undefined {
	const t = text.trim().replace(/[*_`]+/g, "");
	if (!t || t.endsWith("?")) return undefined;
	// last sentence or line
	const lastLine = t.split(/\n+/).pop()!.trim();
	const sentences = lastLine.split(/(?<=[.!?])\s+(?=[A-Z])/);
	const last = sentences[sentences.length - 1].trim();
	if (!last || last.length > 300) return undefined;
	if (NOT_STALL.test(last)) return undefined;
	const m = last.match(INTENT);
	if (!m) return undefined;
	// the intent must open the sentence, after at most a filler word ("Now, let me…", "OK. I'll…")
	if (!LEAD.test(last.slice(0, m.index!))) return undefined;
	const phrase = last.slice(m.index!).replace(/[:.…!]+$/, "").trim();
	return phrase.length > 100 ? `${phrase.slice(0, 97)}...` : phrase;
}
