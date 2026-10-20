#!/usr/bin/env node
// Generates bench/tickets/bulk-rename (deterministic): a 12-module package whose money API is
// renamed. This generator is the TypeScript port of the Python one that made the ticket.
//
//   node bench/gen-bulk-rename.ts
//
// A wide rename: one helper module, twelve modules of call sites in two styles, a deprecated alias
// that must keep working, and results that must not move by a cent. Money is exact cents (bigint),
// so "results must not change" is checkable exactly. The expected values in the hidden tests are
// computed from the generated broken repo, as the Python generator did by importing it.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "tickets", "bulk-rename");

/** Deterministic PRNG (mulberry32): the same ticket every time. */
function rng(seed: number) {
	let a = seed >>> 0;
	const next = () => ((a = (a + 0x6d2b79f5) >>> 0), (a ^ (a >>> 15)) * (1 + (a = (a ^ (a >>> 7)) * 61 >>> 0)) >>> 0) / 4294967296;
	return {
		next,
		int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
		pick: <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)],
	};
}

const MODS = ["cart", "checkout", "invoice", "refunds", "reports", "subscriptions", "coupons", "shipping", "wholesale", "pos", "exports", "audit"];

const MONEY = `// Money helpers shared by every shop module. Items are [price, qty] pairs.
// Money is cents (bigint): exact decimals, never binary floating point.
export type Item = [number, number];
export type Cents = bigint;

const DIGITS = /^(-?)(\\d+)(?:\\.(\\d+))?$/;

/** Parse a price (number, string) into cents, rounding half-up. */
export function toMoney(x: number | string): Cents {
	const s = String(x).trim();
	const m = DIGITS.exec(s);
	if (!m) throw new Error(\`not an amount: \${s}\`);
	const neg = m[1] === "-";
	const frac = (m[3] ?? "").padEnd(3, "0");
	let cents = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
	if (frac[2] >= "5") cents += 1n;
	return neg ? -cents : cents;
}

export function money(x: Cents): string {
	const s = (x < 0n ? -x : x).toString().padStart(3, "0");
	return \`\${x < 0n ? "-" : ""}\${s.slice(0, -2)}.\${s.slice(-2)}\`;
}

function mulRate(cents: Cents, rate: number): Cents {
	const r = toMoney(rate); // the rate in cents: 0.2 -> 20
	const n = cents * (100n + r);
	const neg = n < 0n;
	const a = neg ? -n : n;
	const q = (a + 50n) / 100n; // half-up
	return neg ? -q : q;
}

export function maxMoney(a: Cents, b: Cents): Cents {
	return a > b ? a : b;
}

export function calcTotal(items: Item[], tax: number): Cents {
	/** Total of [price, qty] pairs plus tax; tax is a fraction (0.2 = 20%). */
	const sub = items.reduce((s, [p, q]) => s + toMoney(p) * BigInt(q), 0n);
	return mulRate(sub, tax);
}
`;

function moduleSource(name: string, i: number, r: ReturnType<typeof rng>): string {
	const fns: string[] = [];
	let usesHelper = false;
	for (let k = 0; k < 6; k++) {
		const tax = r.pick(["0.2", "0.09", "0", "0.24", "TAX"]);
		// two call styles: straight to money.ts, and through this module's own wrapper
		const style = r.pick(["direct", "wrapper"]);
		if (style === "wrapper") usesHelper = true;
		const call = style === "direct" ? `calcTotal(items, ${tax})` : `totalWith(items, ${tax})`;
		const filler = Array.from({ length: r.int(6, 14) }, (_, j) => `	// step ${j}: ${r.pick(["normalise", "validate", "log", "convert", "round"])} the input`).join("\n");
		fns.push(`
export function ${name}Case${k}(items: Item[], discount = 0): Cents {
	/** ${name} scenario ${k}: total after an optional absolute discount. */
${filler}
	items = items.filter(([, q]) => q > 0);
	const total = ${call};
	return maxMoney(0n, total - toMoney(discount));
}
`);
	}
	const wrapper = usesHelper ? `
function totalWith(items: Item[], tax: number): Cents {
	return calcTotal(items, tax);
}
` : "";
	return `// The ${name} module.
import { calcTotal, maxMoney, toMoney, type Cents, type Item } from "./money.ts";

export const TAX = 0.${i + 10};
${wrapper}${fns.join("")}`;
}

function refModuleSource(src: string): string {
	return src
		.replace('import { calcTotal, maxMoney, toMoney, type Cents, type Item } from "./money.ts";', 'import { maxMoney, orderTotal, toMoney, type Cents, type Item } from "./money.ts";')
		.replace(/calcTotal\(items, ([^)]*)\)/g, "orderTotal(items, { taxRate: $1 })");
}

const MONEY_REF = `// Money helpers shared by every shop module. Items are [price, qty] pairs.
// Money is cents (bigint): exact decimals, never binary floating point.
export type Item = [number, number];
export type Cents = bigint;

const DIGITS = /^(-?)(\\d+)(?:\\.(\\d+))?$/;

/** Parse a price (number, string) into cents, rounding half-up. */
export function toMoney(x: number | string): Cents {
	const s = String(x).trim();
	const m = DIGITS.exec(s);
	if (!m) throw new Error(\`not an amount: \${s}\`);
	const neg = m[1] === "-";
	const frac = (m[3] ?? "").padEnd(3, "0");
	let cents = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
	if (frac[2] >= "5") cents += 1n;
	return neg ? -cents : cents;
}

export function money(x: Cents): string {
	const s = (x < 0n ? -x : x).toString().padStart(3, "0");
	return \`\${x < 0n ? "-" : ""}\${s.slice(0, -2)}.\${s.slice(-2)}\`;
}

function mulRate(cents: Cents, rate: number): Cents {
	const r = toMoney(rate); // the rate in cents: 0.2 -> 20
	const n = cents * (100n + r);
	const neg = n < 0n;
	const a = neg ? -n : n;
	const q = (a + 50n) / 100n; // half-up
	return neg ? -q : q;
}

export function maxMoney(a: Cents, b: Cents): Cents {
	return a > b ? a : b;
}

export function orderTotal(items: Item[], opts: { taxRate: number }): Cents {
	/** Total of [price, qty] pairs plus tax; opts.taxRate is a fraction (0.2 = 20%). */
	if (typeof opts !== "object" || opts === null || typeof (opts as any).taxRate !== "number")
		throw new TypeError("orderTotal(items, { taxRate }): the tax rate is an option, not a positional argument");
	const sub = items.reduce((s, [p, q]) => s + toMoney(p) * BigInt(q), 0n);
	return mulRate(sub, (opts as any).taxRate);
}

/** Deprecated: use orderTotal(items, { taxRate }). */
export function calcTotal(items: Item[], tax: number): Cents {
	process.emitWarning("calcTotal is deprecated, use orderTotal(items, { taxRate })", "DeprecationWarning");
	return orderTotal(items, { taxRate: tax });
}
`;

const ISSUE = `API change in \`shop\` (every module under \`shop/\`):

\`calcTotal(items, tax)\` in \`shop/money.ts\` becomes \`orderTotal(items, { taxRate })\`: the tax rate
moves into an options object and is renamed to \`taxRate\`. Results must not change — the totals are
exact cents, and every module's numbers must stay the same to the cent.

1. Add \`orderTotal\` to \`shop/money.ts\` and move every call site in every module of \`shop/\` to it
   (\`orderTotal(items, { taxRate: ... })\`). No file other than \`shop/money.ts\` may mention
   \`calcTotal\` afterwards. Call sites are written two ways: straight to \`money.ts\`, and through a
   module's own \`totalWith\` wrapper (update the wrapper's body).
2. Keep \`calcTotal(items, tax)\` in \`shop/money.ts\` as a deprecated alias: it must emit a
   \`DeprecationWarning\` (with \`process.emitWarning(message, "DeprecationWarning")\`) and return the
   same value as \`orderTotal\`.
3. \`orderTotal\` must throw a \`TypeError\` when the tax rate is passed positionally (a number as the
   second argument) or missing.
4. Update README.md to document \`orderTotal\`, and update the existing test to use it.

Run the tests with: node --test tests/*.test.ts
`;

const VISIBLE_TEST = `import assert from "node:assert/strict";
import { test } from "node:test";
import { calcTotal, money } from "../shop/money.ts";

test("total with tax", () => {
	assert.equal(money(calcTotal([[10, 2], [1.5, 1]], 0.2)), "25.80");
});
`;

const README = `# shop

Use \`calcTotal(items, tax)\` from \`shop/money.ts\` to total a list of \`[price, qty]\` pairs with tax
(\`money(calcTotal([[10, 2], [1.5, 1]], 0.2))\` is \`"25.80"\`).
`;

const README_REF = `# shop

Use \`orderTotal(items, { taxRate })\` from \`shop/money.ts\` to total a list of \`[price, qty]\` pairs
with tax (\`money(orderTotal([[10, 2], [1.5, 1]], { taxRate: 0.2 }))\` is \`"25.80"\`).
\`calcTotal(items, tax)\` is deprecated.
`;

const VISIBLE_TEST_REF = VISIBLE_TEST.replace(/calcTotal/g, "orderTotal").replace("[[10, 2], [1.5, 1]], 0.2", "[[10, 2], [1.5, 1]], { taxRate: 0.2 }");

function write(rel: string, text: string) {
	const p = join(ROOT, rel);
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, text);
}

rmSync(ROOT, { recursive: true, force: true });
const r = rng(7);
write("repo/package.json", '{\n  "name": "shop",\n  "private": true,\n  "type": "module"\n}\n');
write("repo/shop/money.ts", MONEY);
write("repo/README.md", README);
write("repo/tests/money.test.ts", VISIBLE_TEST);
const sources: Record<string, string> = {};
for (let i = 0; i < MODS.length; i++) {
	sources[MODS[i]] = moduleSource(MODS[i], i, r);
	write(`repo/shop/${MODS[i]}.ts`, sources[MODS[i]]);
}

// expected values from the original implementation, as the Python generator computed them
const moneyOf: (c: bigint) => string = (await import(pathToFileURL(join(ROOT, "repo", "shop", "money.ts")).href)).money;
const expected: Record<string, string[]> = {};
for (const m of MODS) {
	const mod: any = await import(pathToFileURL(join(ROOT, "repo", "shop", `${m}.ts`)).href);
	for (let k = 0; k < 6; k++) {
		const fn = mod[`${m}Case${k}`];
		// the alias warns; capture the warnings instead of letting them print
		expected[`${m}.${m}Case${k}`] = [withWarningsOff(() => fn([[19.99, 3], [5, 0], [0.35, 7]], 2)), withWarningsOff(() => fn([[100, 1]]))].map(moneyOf);
	}
}

function withWarningsOff<T>(fn: () => T): T {
	const orig = process.emitWarning;
	process.emitWarning = () => {};
	try {
		return fn();
	} finally {
		process.emitWarning = orig;
	}
}

write("ref/shop/money.ts", MONEY_REF);
for (const m of MODS) write(`ref/shop/${m}.ts`, refModuleSource(sources[m]));
write("ref/README.md", README_REF);
write("ref/tests/money.test.ts", VISIBLE_TEST_REF);
write("issue.md", ISSUE);

write(
	"hidden.test.ts",
	`// Generated by bench/gen-bulk-rename.ts: do not edit.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const EXPECTED: Record<string, string[]> = ${JSON.stringify(expected, null, 1)};
const MODS: string[] = ${JSON.stringify(MODS)};

function emitWarnings(fn: () => unknown): string[] {
	const seen: string[] = [];
	const orig = process.emitWarning;
	(process as any).emitWarning = (msg: any, type?: any) => void seen.push(String(typeof type === "string" ? type : (type?.type ?? type?.name ?? msg)));
	try {
		fn();
	} finally {
		process.emitWarning = orig;
	}
	return seen;
}

async function load(mod: string) {
	return import(\`./shop/\${mod}.ts\`);
}

const moneyMod: any = await load("money");
const asMoney = (c: unknown) => moneyMod.money(c);

test("every module's results are unchanged, with no deprecation warning from them", async () => {
	for (const key of Object.keys(EXPECTED)) {
		const [mod, fn] = key.split(".");
		const m: any = await load(mod);
		const f = m[fn];
		const warns = emitWarnings(() => {
			assert.equal(asMoney(f([[19.99, 3], [5, 0], [0.35, 7]], 2)), EXPECTED[key][0], key);
			assert.equal(asMoney(f([[100, 1]])), EXPECTED[key][1], key);
		});
		assert.deepEqual(warns, [], \`\${key} must not use the deprecated alias\`);
	}
});

test("no module other than money.ts mentions calcTotal; all use orderTotal", () => {
	for (const f of readdirSync("shop")) {
		const src = readFileSync(join("shop", f), "utf8");
		if (f === "money.ts") continue;
		assert.doesNotMatch(src, /calcTotal/, f);
		assert.match(src, /orderTotal/, f);
	}
});

test("orderTotal rejects a positional tax rate", async () => {
	const m: any = moneyMod;
	assert.equal(asMoney(m.orderTotal([[10, 2]], { taxRate: 0.5 })), "30.00");
	assert.throws(() => (m.orderTotal as any)([[10, 2]], 0.5), TypeError);
	assert.throws(() => (m.orderTotal as any)([[10, 2]]), TypeError);
});

test("calcTotal stays a deprecated alias with the same result", async () => {
	const m: any = moneyMod;
	let out: unknown;
	const warns = emitWarnings(() => (out = m.calcTotal([[10, 2]], 0.5)));
	assert.equal(asMoney(out as bigint), "30.00");
	assert.ok(warns.some((w) => /DeprecationWarning/.test(w)), JSON.stringify(warns));
});

test("README and the visible test use orderTotal", () => {
	assert.match(readFileSync("README.md", "utf8"), /orderTotal/);
	assert.match(readFileSync(join("tests", "money.test.ts"), "utf8"), /orderTotal/);
});
`,
);

const chars = Object.values(sources).reduce((a, s) => a + s.length, 0);
console.log(`ok, ${chars} chars of modules in ${MODS.length} modules (${Object.keys(expected).length} expected results)`);
