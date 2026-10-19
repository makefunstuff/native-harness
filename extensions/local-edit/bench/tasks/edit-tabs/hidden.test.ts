import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Job, Scheduler, report7 } from "./src/jobs.ts";

function blocks(src: string): Map<string, string> {
	const out = new Map<string, string>();
	const lines = src.split("\n");
	let cls = "";
	let name = "";
	let buf: string[] = [];
	const flush = () => {
		if (name) out.set(name, buf.join("\n").replace(/\s+/g, " ").trim());
		name = "";
		buf = [];
	};
	for (const line of lines) {
		const c = /^export class (\w+)/.exec(line);
		const f = /^export function (\w+)/.exec(line);
		const m = /^(?:  |\t)(?:async )?(\w+)\(.*\)[^;]*\{\s*$/.exec(line);
		if (c || f) {
			flush();
			cls = c ? c[1] : "";
			name = c ? c[1] : f![1];
		} else if (m && cls) {
			flush();
			name = cls + "." + m[1];
		} else if (/^\}/.test(line)) {
			buf.push(line);
			flush();
			cls = "";
			continue;
		}
		if (name) buf.push(line);
	}
	flush();
	return out;
}

function checkUntouched(path: string, original: string, allowed: string[]) {
	const now = blocks(readFileSync(path, "utf8"));
	for (const [name, text] of blocks(original)) {
		if (allowed.includes(name)) continue; // exact names: a class name covers its fields, not its methods
		assert.ok(now.has(name), name + " was removed from " + path);
		if (!name.includes(".") && /^export class /.test(text)) {
			// a class header (its fields): new fields are fine, the original ones must stay
			const have = now.get(name)!;
			for (const field of text.split(/(?<=;)\s/)) assert.ok(have.includes(field.trim()), name + ": field \"" + field.trim() + "\" was removed or changed");
			continue;
		}
		assert.equal(now.get(name), text, name + " in " + path + " was changed, but the ticket did not ask for it");
	}
}

const ORIGINAL = "// Scheduler for periodic jobs (tab-indented: house style).\n\nexport class Job {\n\tname: string;\n\tevery: number;\n\taction: () => unknown;\n\truns = 0;\n\tlast: number | undefined = undefined;\n\n\tconstructor(name: string, every: number, action: () => unknown) {\n\t\tthis.name = name;\n\t\tthis.every = every;\n\t\tthis.action = action;\n\t}\n\n\tdue(now: number): boolean {\n\t\tif (this.last === undefined) {\n\t\t\treturn true;\n\t\t}\n\t\treturn now - this.last >= this.every;\n\t}\n\n\trun(now: number): unknown {\n\t\tthis.runs += 1;\n\t\tthis.last = now;\n\t\treturn this.action();\n\t}\n}\n\nexport class Scheduler {\n\tjobs = new Map<string, Job>();\n\tlog: Array<[number, string, string]> = [];\n\n\tadd(job: Job): void {\n\t\tif (this.jobs.has(job.name)) {\n\t\t\tthrow new Error(\"duplicate job \" + job.name);\n\t\t}\n\t\tthis.jobs.set(job.name, job);\n\t}\n\n\tremove(name: string): void {\n\t\tthis.jobs.delete(name);\n\t}\n\n\ttick(now: number): Record<string, unknown> {\n\t\tconst results: Record<string, unknown> = {};\n\t\tfor (const name of [...this.jobs.keys()].sort()) {\n\t\t\tconst job = this.jobs.get(name)!;\n\t\t\tif (job.due(now)) {\n\t\t\t\ttry {\n\t\t\t\t\tresults[name] = job.run(now);\n\t\t\t\t} catch (e) {\n\t\t\t\t\tthis.log.push([now, name, String(e)]);\n\t\t\t\t\tresults[name] = null;\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t\treturn results;\n\t}\n\n\tnextDue(now: number): [number, string] | undefined {\n\t\tlet best: [number, string] | undefined;\n\t\tfor (const job of this.jobs.values()) {\n\t\t\tconst at = job.last === undefined ? now : job.last + job.every;\n\t\t\tif (!best || at < best[0] || (at === best[0] && job.name < best[1])) {\n\t\t\t\tbest = [at, job.name];\n\t\t\t}\n\t\t}\n\t\treturn best;\n\t}\n}\n\nexport function report0(scheduler: Scheduler, now: number): string {\n\t// Summary 0: jobs whose period is a multiple of 2.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 2 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report1(scheduler: Scheduler, now: number): string {\n\t// Summary 1: jobs whose period is a multiple of 3.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 3 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report2(scheduler: Scheduler, now: number): string {\n\t// Summary 2: jobs whose period is a multiple of 4.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 4 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report3(scheduler: Scheduler, now: number): string {\n\t// Summary 3: jobs whose period is a multiple of 5.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 5 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report4(scheduler: Scheduler, now: number): string {\n\t// Summary 4: jobs whose period is a multiple of 6.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 6 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report5(scheduler: Scheduler, now: number): string {\n\t// Summary 5: jobs whose period is a multiple of 7.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 7 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report6(scheduler: Scheduler, now: number): string {\n\t// Summary 6: jobs whose period is a multiple of 8.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 8 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report7(scheduler: Scheduler, now: number): string {\n\t// Summary 7: jobs whose period is a multiple of 9.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 9 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report8(scheduler: Scheduler, now: number): string {\n\t// Summary 8: jobs whose period is a multiple of 10.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 10 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report9(scheduler: Scheduler, now: number): string {\n\t// Summary 9: jobs whose period is a multiple of 11.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 11 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report10(scheduler: Scheduler, now: number): string {\n\t// Summary 10: jobs whose period is a multiple of 12.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 12 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report11(scheduler: Scheduler, now: number): string {\n\t// Summary 11: jobs whose period is a multiple of 13.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 13 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report12(scheduler: Scheduler, now: number): string {\n\t// Summary 12: jobs whose period is a multiple of 14.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 14 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report13(scheduler: Scheduler, now: number): string {\n\t// Summary 13: jobs whose period is a multiple of 15.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 15 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report14(scheduler: Scheduler, now: number): string {\n\t// Summary 14: jobs whose period is a multiple of 16.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 16 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report15(scheduler: Scheduler, now: number): string {\n\t// Summary 15: jobs whose period is a multiple of 17.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 17 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report16(scheduler: Scheduler, now: number): string {\n\t// Summary 16: jobs whose period is a multiple of 18.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 18 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n\nexport function report17(scheduler: Scheduler, now: number): string {\n\t// Summary 17: jobs whose period is a multiple of 19.\n\tconst lines: string[] = [];\n\tfor (const name of [...scheduler.jobs.keys()].sort()) {\n\t\tconst job = scheduler.jobs.get(name)!;\n\t\tif (job.every % 19 === 0) {\n\t\t\tconst state = job.due(now) ? \"due\" : \"waiting\";\n\t\t\tlines.push(name + \": \" + state + \" (\" + job.runs + \" runs)\");\n\t\t}\n\t}\n\treturn lines.join(\"\\n\");\n}\n";

test("a job stops after 3 failures in a row", () => {
	let calls = 0;
	const s = new Scheduler();
	s.add(new Job("b", 1, () => { calls++; throw new Error("x"); }));
	for (let t = 0; t < 6; t++) s.tick(t);
	assert.equal(calls, 3);
	assert.equal(s.log.length, 3);
});

test("a success resets the count", () => {
	let n = 0;
	const s = new Scheduler();
	s.add(new Job("f", 1, () => { n++; if (n % 3 === 0) return "ok"; throw new Error("x"); }));
	for (let t = 0; t < 9; t++) s.tick(t);
	assert.equal(n, 9);
});

test("remove of an unknown job", () => {
	assert.throws(() => new Scheduler().remove("zz"), /no job zz/);
});

test("report7 lists due jobs", () => {
	const s = new Scheduler();
	s.add(new Job("nine", 9, () => 1));
	s.add(new Job("five", 5, () => 1));
	s.add(new Job("six", 6, () => 1));
	s.tick(0);
	const out = report7(s, 5);
	assert.match(out, /five: due/);
	assert.match(out, /nine: waiting/);
	assert.doesNotMatch(out, /six/);
});

test("tabs kept", () => {
	const lines = readFileSync("src/jobs.ts", "utf8").split("\n");
	assert.ok(!lines.some((l) => l.startsWith("  ")), "space-indented lines in src/jobs.ts");
});

test("others untouched", () => {
	checkUntouched("src/jobs.ts", ORIGINAL, ["Scheduler.tick", "Scheduler.remove", "report7"]);
});
