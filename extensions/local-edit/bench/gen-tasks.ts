// Generates the edit-heavy tickets under bench/tasks/ (deterministic; the output is committed).
//
//   node extensions/local-edit/bench/gen-tasks.ts [OUT_DIR]
//
// Each ticket is TypeScript: repo/ (one large module, visible tests in tests/, run with
// `node --test tests/*.test.ts`), ref/ (the reference solution), issue.md, and hidden.test.ts. The hidden
// test checks the requested behaviour AND that every function/method the ticket does not ask to
// change is still there, unchanged (whitespace-normalised): the "destructive edit" check.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? join(HERE, "tasks");

// Shared by the hidden tests: split a module into top-level functions, classes and methods.
const GUARD = String.raw`
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
`;

interface Ticket {
	files: Record<string, string>;
	issue: string;
	hidden: string;
	ref: Record<string, Array<[string, string]>>;
}

function write(name: string, t: Ticket) {
	const d = join(OUT, name);
	rmSync(d, { recursive: true, force: true });
	for (const [rel, body] of Object.entries(t.files)) {
		for (const kind of ["repo", "ref"]) {
			let b = body;
			if (kind === "ref")
				for (const [o, n] of t.ref[rel] ?? []) {
					if (b.split(o).length !== 2) throw new Error(`${name}/${rel}: reference edit not unique: ${o.slice(0, 60)}`);
					b = b.replace(o, () => n);
				}
			const p = join(d, kind, rel);
			mkdirSync(dirname(p), { recursive: true });
			writeFileSync(p, b);
		}
	}
	writeFileSync(join(d, "issue.md"), t.issue.replace(/^\n/, "").replace(/^ {4}/gm, ""));
	writeFileSync(join(d, "hidden.test.ts"), t.hidden);
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- handlers: near-duplicate blocks
function handlers(): Ticket {
	const kinds = ["user", "order", "invoice", "refund", "shipment", "coupon", "review", "address", "payment", "session", "cart", "wishlist", "ticket", "subscription", "report", "webhook"];
	let src = `// Request handlers for the shop API. Each handler validates, loads, and serialises one resource.

export class NotFound extends Error {}

export class Invalid extends Error {}

export type Store = Map<string, Record<string, unknown>>;

export const key = (kind: string, id: unknown) => kind + ":" + String(id);
`;
	for (const k of kinds) {
		src += `
export class ${cap(k)}Handler {
  // Handles /${k}s requests.
  resource = "${k}";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("${k}: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("${k}: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("${k}", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("${k} " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "${k}";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}
`;
	}
	return {
		files: {
			"src/handlers.ts": src,
			"tests/handlers.test.ts": `import assert from "node:assert/strict";
import { test } from "node:test";
import { NotFound, OrderHandler, UserHandler, key } from "../src/handlers.ts";

test("user", () => {
  const h = new UserHandler(new Map([[key("user", 1), { name: "a" }]]));
  assert.deepEqual(JSON.parse(h.handle({ id: 1 })), { name: "a", type: "user" });
});

test("missing", () => {
  assert.throws(() => new OrderHandler(new Map()).handle({ id: 2 }), NotFound);
});
`,
		},
		issue: `
    In \`src/handlers.ts\`, three handlers need changes; leave every other handler exactly as it is.

    1. \`RefundHandler.validate\` must also reject a payload whose \`amount\` is present and negative:
       throw \`new Invalid("refund: negative amount")\`.
    2. \`ShipmentHandler.serialise\` must add \`tracking: item.tracking ?? ""\` to the output (keep
       the \`type\` key).
    3. \`CouponHandler.load\` must upper-case string ids before looking them up (\`"ab"\` -> \`"AB"\`);
       other ids are looked up unchanged.

    Add tests for the three changes to \`tests/handlers.test.ts\`.
    Run the tests with: node --test tests/*.test.ts
    `,
		hidden: `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CouponHandler, Invalid, RefundHandler, ShipmentHandler, key } from "./src/handlers.ts";
${GUARD}
const ORIGINAL = ${JSON.stringify(src)};

test("refund rejects a negative amount", () => {
  const h = new RefundHandler(new Map([[key("refund", 1), { x: 1 }]]));
  assert.throws(() => h.validate({ id: 1, amount: -5 }), Invalid);
  assert.equal(h.validate({ id: 1, amount: 5 }), true);
  assert.equal(h.validate({ id: 1 }), true);
});

test("shipment has tracking", () => {
  const h = new ShipmentHandler(new Map([[key("shipment", 3), { tracking: "Z9" }], [key("shipment", 4), {}]]));
  assert.equal(JSON.parse(h.handle({ id: 3 })).tracking, "Z9");
  const out = JSON.parse(h.handle({ id: 4 }));
  assert.equal(out.tracking, "");
  assert.equal(out.type, "shipment");
});

test("coupon ids are upper-cased", () => {
  const h = new CouponHandler(new Map([[key("coupon", "AB"), { v: 1 }], [key("coupon", 7), { v: 2 }]]));
  assert.equal(JSON.parse(h.handle({ id: "ab" })).v, 1);
  assert.equal(JSON.parse(h.handle({ id: 7 })).v, 2);
});

test("others untouched", () => {
  checkUntouched("src/handlers.ts", ORIGINAL, ["RefundHandler.validate", "ShipmentHandler.serialise", "CouponHandler.load"]);
});
`,
		ref: {
			"src/handlers.ts": [
				[`throw new Invalid("refund: missing id");\n    }\n    return true;`, `throw new Invalid("refund: missing id");\n    }\n    if (typeof payload.amount === "number" && payload.amount < 0) {\n      throw new Invalid("refund: negative amount");\n    }\n    return true;`],
				[`data.type = "shipment";`, `data.type = "shipment";\n    data.tracking = item.tracking ?? "";`],
				[`    this.calls += 1;\n    for (let attempt = 0; attempt < this.retries; attempt++) {\n      const item = this.store.get(key("coupon", ident));`, `    this.calls += 1;\n    if (typeof ident === "string") {\n      ident = ident.toUpperCase();\n    }\n    for (let attempt = 0; attempt < this.retries; attempt++) {\n      const item = this.store.get(key("coupon", ident));`],
			],
		},
	};
}

// ---------------------------------------------------------------- tabs: a tab-indented module
function tabs(): Ticket {
	let src = `// Scheduler for periodic jobs (tab-indented: house style).

export class Job {
	name: string;
	every: number;
	action: () => unknown;
	runs = 0;
	last: number | undefined = undefined;

	constructor(name: string, every: number, action: () => unknown) {
		this.name = name;
		this.every = every;
		this.action = action;
	}

	due(now: number): boolean {
		if (this.last === undefined) {
			return true;
		}
		return now - this.last >= this.every;
	}

	run(now: number): unknown {
		this.runs += 1;
		this.last = now;
		return this.action();
	}
}

export class Scheduler {
	jobs = new Map<string, Job>();
	log: Array<[number, string, string]> = [];

	add(job: Job): void {
		if (this.jobs.has(job.name)) {
			throw new Error("duplicate job " + job.name);
		}
		this.jobs.set(job.name, job);
	}

	remove(name: string): void {
		this.jobs.delete(name);
	}

	tick(now: number): Record<string, unknown> {
		const results: Record<string, unknown> = {};
		for (const name of [...this.jobs.keys()].sort()) {
			const job = this.jobs.get(name)!;
			if (job.due(now)) {
				try {
					results[name] = job.run(now);
				} catch (e) {
					this.log.push([now, name, String(e)]);
					results[name] = null;
				}
			}
		}
		return results;
	}

	nextDue(now: number): [number, string] | undefined {
		let best: [number, string] | undefined;
		for (const job of this.jobs.values()) {
			const at = job.last === undefined ? now : job.last + job.every;
			if (!best || at < best[0] || (at === best[0] && job.name < best[1])) {
				best = [at, job.name];
			}
		}
		return best;
	}
}
`;
	for (let i = 0; i < 18; i++)
		src += `
export function report${i}(scheduler: Scheduler, now: number): string {
	// Summary ${i}: jobs whose period is a multiple of ${i + 2}.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % ${i + 2} === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\\n");
}
`;
	return {
		files: {
			"src/jobs.ts": src,
			"tests/jobs.test.ts": `import assert from "node:assert/strict";
import { test } from "node:test";
import { Job, Scheduler } from "../src/jobs.ts";

test("tick", () => {
	const s = new Scheduler();
	s.add(new Job("a", 10, () => 1));
	assert.deepEqual(s.tick(0), { a: 1 });
	assert.deepEqual(s.tick(5), {});
});
`,
		},
		issue: `
    \`src/jobs.ts\` (tab-indented; keep it that way) needs three changes. Do not touch anything else.

    1. \`Scheduler.tick\` must stop calling a job after it has failed 3 times in a row: count
       consecutive failures per job (reset on success) and skip the job once the count reaches 3.
       Failures are still logged as they are now.
    2. \`Scheduler.remove\` of an unknown name must throw \`new Error("no job <name>")\`.
    3. \`report7\` must also list jobs that are due, whatever their period: a job is listed when its
       period is a multiple of 9 OR it is due now.

    Add tests to \`tests/jobs.test.ts\`. Run them with: node --test tests/*.test.ts
    `,
		hidden: `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Job, Scheduler, report7 } from "./src/jobs.ts";
${GUARD}
const ORIGINAL = ${JSON.stringify(src)};

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
	const lines = readFileSync("src/jobs.ts", "utf8").split("\\n");
	assert.ok(!lines.some((l) => l.startsWith("  ")), "space-indented lines in src/jobs.ts");
});

test("others untouched", () => {
	checkUntouched("src/jobs.ts", ORIGINAL, ["Scheduler.tick", "Scheduler.remove", "report7"]);
});
`,
		ref: {
			"src/jobs.ts": [
				["\tlog: Array<[number, string, string]> = [];\n", "\tlog: Array<[number, string, string]> = [];\n\tfailures = new Map<string, number>();\n"],
				["\tremove(name: string): void {\n\t\tthis.jobs.delete(name);", "\tremove(name: string): void {\n\t\tif (!this.jobs.has(name)) {\n\t\t\tthrow new Error(\"no job \" + name);\n\t\t}\n\t\tthis.jobs.delete(name);"],
				[
					"\t\t\tif (job.due(now)) {\n\t\t\t\ttry {\n\t\t\t\t\tresults[name] = job.run(now);\n\t\t\t\t} catch (e) {\n\t\t\t\t\tthis.log.push([now, name, String(e)]);\n\t\t\t\t\tresults[name] = null;",
					"\t\t\tif ((this.failures.get(name) ?? 0) >= 3) {\n\t\t\t\tcontinue;\n\t\t\t}\n\t\t\tif (job.due(now)) {\n\t\t\t\ttry {\n\t\t\t\t\tresults[name] = job.run(now);\n\t\t\t\t\tthis.failures.set(name, 0);\n\t\t\t\t} catch (e) {\n\t\t\t\t\tthis.log.push([now, name, String(e)]);\n\t\t\t\t\tthis.failures.set(name, (this.failures.get(name) ?? 0) + 1);\n\t\t\t\t\tresults[name] = null;",
				],
				["\t\tif (job.every % 9 === 0) {", "\t\tif (job.every % 9 === 0 || job.due(now)) {"],
			],
		},
	};
}

// ---------------------------------------------------------------- table: long literal lines
function table(): Ticket {
	const countries = ["at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "hu", "ie", "it", "lv", "lt", "lu", "mt", "nl", "pl", "pt", "ro", "sk", "si", "es", "se"];
	const rows = countries.map((c, i) => {
		const std = 17 + ((i * 7) % 11);
		const red = 5 + ((i * 3) % 9);
		return `  ${c}: { standard: ${std}, reduced: [${red}, ${red + 4}], currency: "EUR", nameEn: "${c.toUpperCase()} country ${i}", notes: "rate table entry ${i}, updated 2026-01-01; see the official journal for the legal text" },\n`;
	});
	const src = `// VAT rates per EU country (a long table) and helpers.

export interface Entry {
  standard: number;
  reduced: number[];
  superReduced?: number;
  currency: string;
  nameEn: string;
  notes: string;
}

export const RATES: Record<string, Entry> = {
${rows.join("")}};

export function rate(country: string, kind = "standard"): number {
  const entry = RATES[country.toLowerCase()];
  if (kind === "standard") {
    return entry.standard;
  }
  if (kind === "reduced") {
    return Math.min(...entry.reduced);
  }
  throw new Error("unknown kind " + kind);
}

export function gross(net: number, country: string, kind = "standard"): number {
  return Math.round(net * (1 + rate(country, kind) / 100) * 100) / 100;
}

export function countriesAbove(threshold: number): string[] {
  return Object.keys(RATES).filter((c) => RATES[c].standard > threshold).sort();
}
`;
	const line = (c: string) => rows[countries.indexOf(c)];
	return {
		files: {
			"src/vat.ts": src,
			"tests/vat.test.ts": `import assert from "node:assert/strict";
import { test } from "node:test";
import { RATES, gross } from "../src/vat.ts";

test("gross", () => {
  assert.equal(gross(100, "AT"), 100 + RATES.at.standard);
});
`,
		},
		issue: `
    Updates to \`src/vat.ts\`. Change only what is listed; every other table entry must stay byte-for-byte
    the same (the table is diffed against the official journal).

    1. \`fi\`: the standard rate is now 26 (was 24), and its notes become
       \`"rate table entry 8, updated 2026-09-01"\`.
    2. \`ee\`: the reduced rates are now \`[9, 13]\`.
    3. \`sk\`: the standard rate is now 23.
    4. \`rate()\` gets a new kind \`"superReduced"\`: return the entry's \`superReduced\` value when the
       entry has one, else throw \`new Error("no super-reduced rate for <country>")\`. Add
       \`superReduced: 4.8\` to the \`fr\` entry (keep the other keys of that entry as they are).

    Add tests to \`tests/vat.test.ts\`. Run them with: node --test tests/*.test.ts
    `,
		hidden: `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RATES, countriesAbove, rate } from "./src/vat.ts";

const ORIGINAL = ${JSON.stringify(src)};

test("values", () => {
  assert.equal(RATES.fi.standard, 26);
  assert.equal(RATES.fi.notes, "rate table entry 8, updated 2026-09-01");
  assert.deepEqual(RATES.ee.reduced, [9, 13]);
  assert.equal(RATES.sk.standard, 23);
  assert.equal(RATES.fr.superReduced, 4.8);
  assert.equal(rate("FR", "superReduced"), 4.8);
  assert.throws(() => rate("de", "superReduced"), /no super-reduced rate for de/);
  assert.equal(rate("de", "reduced"), Math.min(...RATES.de.reduced));
});

test("other lines untouched", () => {
  const now = readFileSync("src/vat.ts", "utf8").split("\\n");
  for (const l of ORIGINAL.split("\\n")) {
    if (/^  [a-z]{2}: \\{/.test(l) && !/^  (fi|ee|sk|fr): /.test(l)) assert.ok(now.includes(l), "table line changed or removed: " + l.slice(0, 40));
  }
  assert.equal(Object.keys(RATES).length, 27);
  assert.deepEqual(countriesAbove(100), []);
});
`,
		ref: {
			"src/vat.ts": [
				[line("fi"), line("fi").replace(/standard: \d+/, "standard: 26").replace("rate table entry 8, updated 2026-01-01; see the official journal for the legal text", "rate table entry 8, updated 2026-09-01")],
				[line("ee"), line("ee").replace(/reduced: \[[^\]]*\]/, "reduced: [9, 13]")],
				[line("sk"), line("sk").replace(/standard: \d+/, "standard: 23")],
				[line("fr"), line("fr").replace("currency:", "superReduced: 4.8, currency:")],
				["    return Math.min(...entry.reduced);\n  }\n", '    return Math.min(...entry.reduced);\n  }\n  if (kind === "superReduced") {\n    if (entry.superReduced === undefined) {\n      throw new Error("no super-reduced rate for " + country);\n    }\n    return entry.superReduced;\n  }\n'],
			],
		},
	};
}

write("edit-handlers", handlers());
write("edit-tabs", tabs());
write("edit-table", table());
console.log(`tickets written to ${OUT}`);
