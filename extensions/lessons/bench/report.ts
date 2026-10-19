#!/usr/bin/env node
// Summary of the lessons benchmark: node bench/report.ts [results/*.jsonl …] > results/summary.md
//
// Repeated-mistake rate: walk each sequence run (arm, model, sequence, round) ticket by ticket.
// A mistake is a house rule the ticket broke, either during the session (its own test output
// shows the checker's message) or in the final tree (the grader's checker run). On ticket k ≥ 2,
// every rule that was already broken on an earlier ticket of the same run is an opportunity to
// repeat; it is repeated when ticket k breaks it again.
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface Row {
	arm: string;
	model: string;
	seq: string;
	ticket: string;
	pos: number;
	round: number;
	passed: boolean;
	traps_possible: string[];
	traps_seen: string[];
	traps_left: string[];
	mistakes: string[];
	assistant_turns: number;
	tool_calls: number;
	input_tokens: number;
	cache_read_tokens: number;
	output_tokens: number;
	cost: number;
	wall_s: number;
	lessons_shown: number;
	asked: boolean;
	ask_input: number;
	ask_cache_read: number;
	ask_output: number;
	recall?: any;
	notes?: string[];
}

export interface Summary {
	group: string;
	tickets: number;
	passed: number;
	mistakes: number;
	firstMistakes: number; // on ticket 1 of each run (nothing learned yet in either arm)
	firstTickets: number;
	laterMistakes: number;
	laterTickets: number;
	opportunities: number;
	repeated: number;
	cleanLater: number; // later tickets with no mistake at all
	turns: number;
	tokens: number; // input + cache read + output
	output: number;
	cost: number;
	wall: number;
	shown: number; // tickets that got lessons appended
	asked: number; // lesson requests
	askTokens: number;
	fallbacks: number; // tickets where the extension reported a fallback
}

export function summarise(group: string, rows: Row[]): Summary {
	const s: Summary = {
		group,
		tickets: rows.length,
		passed: 0,
		mistakes: 0,
		firstMistakes: 0,
		firstTickets: 0,
		laterMistakes: 0,
		laterTickets: 0,
		opportunities: 0,
		repeated: 0,
		cleanLater: 0,
		turns: 0,
		tokens: 0,
		output: 0,
		cost: 0,
		wall: 0,
		shown: 0,
		asked: 0,
		askTokens: 0,
		fallbacks: 0,
	};
	const runs = new Map<string, Row[]>();
	for (const r of rows) {
		const k = `${r.arm}|${r.model}|${r.seq}|${r.round}`;
		if (!runs.has(k)) runs.set(k, []);
		runs.get(k)!.push(r);
	}
	for (const run of runs.values()) {
		run.sort((a, b) => a.pos - b.pos);
		const before = new Set<string>();
		for (const r of run) {
			const m = new Set(r.mistakes);
			if (r.pos === 1) {
				s.firstTickets++;
				s.firstMistakes += m.size;
			} else {
				s.laterTickets++;
				s.laterMistakes += m.size;
				if (!m.size) s.cleanLater++;
				for (const t of r.traps_possible) {
					if (!before.has(t)) continue;
					s.opportunities++;
					if (m.has(t)) s.repeated++;
				}
			}
			for (const t of m) before.add(t);
		}
	}
	for (const r of rows) {
		if (r.passed) s.passed++;
		s.mistakes += r.mistakes.length;
		s.turns += r.assistant_turns;
		s.tokens += r.input_tokens + r.cache_read_tokens + r.output_tokens;
		s.output += r.output_tokens;
		s.cost += r.cost;
		s.wall += r.wall_s;
		if (r.lessons_shown > 0) s.shown++;
		if (r.asked) {
			s.asked++;
			s.askTokens += r.ask_input + r.ask_cache_read + r.ask_output;
		}
		if ((r.notes ?? []).some((n) => /failed|fall/i.test(n)) || r.recall?.fallback || r.recall?.judgeFallback) s.fallbacks++;
	}
	return s;
}

// Fisher's exact test, two-sided, for a 2×2 table [[a, b], [c, d]].
export function fisher(a: number, b: number, c: number, d: number): number {
	const lf = (n: number) => {
		let x = 0;
		for (let i = 2; i <= n; i++) x += Math.log(i);
		return x;
	};
	const n = a + b + c + d;
	const p = (x: number) => {
		const y = a + b - x;
		const z = a + c - x;
		const w = n - x - y - z;
		if (y < 0 || z < 0 || w < 0) return 0;
		return Math.exp(lf(a + b) + lf(c + d) + lf(a + c) + lf(b + d) - lf(n) - lf(x) - lf(y) - lf(z) - lf(w));
	};
	const p0 = p(a);
	let total = 0;
	for (let x = 0; x <= Math.min(a + b, a + c); x++) {
		const px = p(x);
		if (px <= p0 * (1 + 1e-9)) total += px;
	}
	return Math.min(1, total);
}

const pct = (x: number, n: number) => (n ? `${((100 * x) / n).toFixed(0)} %` : "–");
const per = (x: number, n: number, d = 1) => (n ? (x / n).toFixed(d) : "–");

export function report(rows: Row[]): string {
	const groups = new Map<string, Row[]>();
	for (const r of rows) {
		const k = `${r.arm} · ${r.model}`;
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k)!.push(r);
	}
	const sums = [...groups.entries()].map(([k, v]) => summarise(k, v)).sort((a, b) => a.group.localeCompare(b.group));
	const out: string[] = [];
	out.push("| arm · model | tickets | passed | repeated mistakes (rate) | mistakes on ticket 1 | mistakes / later ticket | later tickets clean | turns / ticket | tokens / ticket | output tok / ticket | s / ticket | lessons shown | lesson requests (tokens each) | fallbacks |");
	out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
	for (const s of sums) {
		out.push(
			`| ${s.group} | ${s.tickets} | ${s.passed} | ${s.repeated}/${s.opportunities} (${pct(s.repeated, s.opportunities)}) | ${per(s.firstMistakes, s.firstTickets, 2)} | ${per(s.laterMistakes, s.laterTickets, 2)} | ${s.cleanLater}/${s.laterTickets} | ${per(s.turns, s.tickets)} | ${per(s.tokens, s.tickets, 0)} | ${per(s.output, s.tickets, 0)} | ${per(s.wall, s.tickets)} | ${s.shown} | ${s.asked} (${per(s.askTokens, s.asked, 0)}) | ${s.fallbacks} |`,
		);
	}
	const base = sums.find((s) => s.group.startsWith("base ·"));
	if (base) {
		out.push("");
		for (const s of sums.filter((x) => x !== base && x.group.split(" · ")[1] === base.group.split(" · ")[1])) {
			const p = fisher(s.repeated, s.opportunities - s.repeated, base.repeated, base.opportunities - base.repeated);
			out.push(`- ${s.group} vs ${base.group}: repeated ${s.repeated}/${s.opportunities} vs ${base.repeated}/${base.opportunities}, Fisher exact p = ${p.toFixed(3)}`);
		}
	}
	// per sequence and position
	out.push("", "Mistakes per ticket position (sum over rounds):", "");
	const seqs = [...new Set(rows.map((r) => r.seq))].sort();
	const arms = [...groups.keys()].sort();
	for (const seq of seqs) {
		const positions = [...new Set(rows.filter((r) => r.seq === seq).map((r) => r.pos))].sort((a, b) => a - b);
		out.push(`| ${seq} | ${positions.map((p) => `#${p}`).join(" | ")} |`);
		out.push(`|---|${positions.map(() => "---").join("|")}|`);
		for (const a of arms) {
			const cells = positions.map((p) => {
				const rs = groups.get(a)!.filter((r) => r.seq === seq && r.pos === p);
				const tally = new Map<string, number>();
				for (const r of rs) for (const m of r.mistakes) tally.set(m, (tally.get(m) ?? 0) + 1);
				return rs.length ? [...tally.entries()].map(([m, n]) => `${m}×${n}`).join(", ") || "–" : "";
			});
			out.push(`| ${a} | ${cells.join(" | ")} |`);
		}
		out.push("");
	}
	return out.join("\n");
}

function main() {
	const args = process.argv.slice(2);
	const files = args.length ? args : readdirSync(join(HERE, "results")).filter((f) => f.endsWith(".jsonl")).map((f) => join(HERE, "results", f));
	const rows: Row[] = files.flatMap((f) =>
		readFileSync(f, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l)),
	);
	console.log(`<!-- generated by bench/report.ts from ${files.map((f) => basename(f)).join(", ")} -->\n`);
	console.log(report(rows));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
