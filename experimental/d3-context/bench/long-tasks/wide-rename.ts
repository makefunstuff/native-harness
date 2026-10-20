// wide-rename: a 9-module package whose money API is renamed. A long read: the agent must find and
// update every call site across modules, keep results to the cent, and keep a deprecated alias.
import { pathToFileURL } from "node:url";
import { lines, range, type Task, type Writer } from "./util.ts";

const MODULES = ["api", "billing", "catalog", "cart", "checkout", "reports", "search", "shipping", "emails"];
const PRICES = [19.99, 5, 0.35, 100, 2.5, 42, 7.77, 13];

const moneyModule = `// Money helpers of the shop. Items are [price, qty] pairs; money is cents (bigint).
export type Item = [number, number];
export type Cents = bigint;

const DIGITS = /^(-?)(\\d+)(?:\\.(\\d+))?$/;

export function toMoney(x: number | string): Cents {
	const s = String(x).trim();
	const m = DIGITS.exec(s);
	if (!m) throw new Error(\`not an amount: \${s}\`);
	const frac = (m[3] ?? "").padEnd(3, "0");
	let cents = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
	if (frac[2] >= "5") cents += 1n;
	return m[1] === "-" ? -cents : cents;
}

export function money(x: Cents): string {
	const s = (x < 0n ? -x : x).toString().padStart(3, "0");
	return \`\${x < 0n ? "-" : ""}\${s.slice(0, -2)}.\${s.slice(-2)}\`;
}

export function maxMoney(a: Cents, b: Cents): Cents {
	return a > b ? a : b;
}

function mulRate(cents: Cents, rate: number): Cents {
	const r = toMoney(rate);
	const n = cents * (100n + r);
	const a = n < 0n ? -n : n;
	const q = (a + 50n) / 100n;
	return n < 0n ? -q : q;
}

export function calcTotal(items: Item[], tax: number): Cents {
	/** Total of [price, qty] pairs plus a tax fraction (0.2 = 20%). */
	const sub = items.reduce((s, [p, q]) => s + toMoney(p) * BigInt(q), 0n);
	return mulRate(sub, tax);
}
`;

const moneyRef = moneyModule
	.replace(
		`export function calcTotal(items: Item[], tax: number): Cents {
	/** Total of [price, qty] pairs plus a tax fraction (0.2 = 20%). */
	const sub = items.reduce((s, [p, q]) => s + toMoney(p) * BigInt(q), 0n);
	return mulRate(sub, tax);
}`,
		`export function orderTotal(items: Item[], opts: { taxRate: number }): Cents {
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
}`,
	);

function moduleOf(name: string, i: number): string {
	const fns = Array.from({ length: 6 }, (_, k) => {
		const tax = ["0.2", "0.09", "0", "0.24", "TAX"][k % 5];
		return `
export function ${name}Case${k}(items: Item[], discount = 0): Cents {
	/** ${name} scenario ${k}: the total after an optional absolute discount. */
${range(6 + ((i + k) % 8), (j) => `	// step ${j}: ${["normalise", "validate", "log", "convert", "round"][(i + j) % 5]} the input`)}
	items = items.filter(([, q]) => q > 0);
	const total = ${k % 3 === 1 ? `totalWith(items, ${tax})` : `calcTotal(items, ${tax})`};
	return maxMoney(0n, total - toMoney(discount));
}
`;
	}).join("");
	const wrapper = `
function totalWith(items: Item[], tax: number): Cents {
	return calcTotal(items, tax);
}
`;
	return `// The ${name} module of the shop.
import { calcTotal, maxMoney, toMoney, type Cents, type Item } from "./money.ts";

export const TAX = 0.${10 + i};
${wrapper}${fns}`;
}

function refOf(src: string): string {
	return src
		.replace('import { calcTotal, maxMoney, toMoney, type Cents, type Item } from "./money.ts";', 'import { maxMoney, orderTotal, toMoney, type Cents, type Item } from "./money.ts";')
		.replace(/calcTotal\(items, ([^)]*)\)/g, "orderTotal(items, { taxRate: $1 })");
}

export const wideRename: Task = {
	name: "wide-rename",
	questions: [],
	async build(w: Writer) {
		w("repo/package.json", '{\n  "name": "shop",\n  "private": true,\n  "type": "module"\n}\n');
		w("repo/shop/money.ts", moneyModule);
		w("repo/README.md", `# shop\n\nTotal a list of \`[price, qty]\` pairs with \`calcTotal(items, tax)\` from \`shop/money.ts\`:\n\`money(calcTotal([[10, 2], [1.5, 1]], 0.2))\` is \`"25.80"\`.\n`);
		w("repo/tests/money.test.ts", `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { calcTotal, money } from "../shop/money.ts";\n\ntest("total with tax", () => {\n\tassert.equal(money(calcTotal([[10, 2], [1.5, 1]], 0.2)), "25.80");\n});\n`);

		const expected: Record<string, string[]> = {};
		const { money: fmt } = await import(pathToFileURL(w.path("repo/shop/money.ts")).href) as any;
		for (let i = 0; i < MODULES.length; i++) {
			const name = MODULES[i];
			const src = moduleOf(name, i);
			w(`repo/shop/${name}.ts`, src);
			w(`ref/shop/${name}.ts`, refOf(src));
			const mod: any = await import(pathToFileURL(w.path(`repo/shop/${name}.ts`)).href);
			for (let k = 0; k < 6; k++) {
				const f = mod[`${name}Case${k}`];
				const quiet = (fn: () => any) => {
					const orig = process.emitWarning;
					process.emitWarning = () => {};
					try {
						return fn();
					} finally {
						process.emitWarning = orig;
					}
				};
				expected[`${name}.${name}Case${k}`] = [quiet(() => f([[PRICES[0], 3], [PRICES[2], 0], [PRICES[1], 7]], 2)), quiet(() => f([[100, 1]]))].map(fmt);
			}
		}
		w("ref/shop/money.ts", moneyRef);
		w("ref/README.md", `# shop\n\nTotal a list of \`[price, qty]\` pairs with \`orderTotal(items, { taxRate })\` from \`shop/money.ts\`:\n\`money(orderTotal([[10, 2], [1.5, 1]], { taxRate: 0.2 }))\` is \`"25.80"\`.\n\`calcTotal\` is deprecated.\n`);
		w("ref/tests/money.test.ts", `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { money, orderTotal } from "../shop/money.ts";\n\ntest("total with tax", () => {\n\tassert.equal(money(orderTotal([[10, 2], [1.5, 1]], { taxRate: 0.2 })), "25.80");\n});\n`);

		w(
			"issue.md",
			lines([
				"API change in `shop` (every module under `shop/`):",
				"",
				"`calcTotal(items, tax)` in `shop/money.ts` becomes `orderTotal(items, { taxRate })`: the tax",
				"rate moves into an options object and is renamed. The totals are exact cents and must not",
				"move by a cent.",
				"",
				"1. Add `orderTotal` to `shop/money.ts` and move every call site in every module of `shop/` to",
				"   it (`orderTotal(items, { taxRate: ... })`). No file other than `shop/money.ts` may mention",
				"   `calcTotal` afterwards. Call sites are written two ways: straight to `money.ts`, and",
				"   through a module's own `totalWith` wrapper (update the wrapper's body).",
				"2. Keep `calcTotal(items, tax)` in `shop/money.ts` as a deprecated alias: emit a",
				"   `DeprecationWarning` with `process.emitWarning(message, 'DeprecationWarning')` and return",
				"   the same value as `orderTotal`.",
				"3. `orderTotal` must throw a `TypeError` when the tax rate is passed positionally (a number as",
				"   the second argument) or missing.",
				"4. Update README.md and the existing test to use `orderTotal`.",
				"",
				"Run the tests with: node --test tests/*.test.ts",
			]),
		);
		w(
			"hidden.test.ts",
			`// Generated by gen-long-tasks.ts: do not edit.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const EXPECTED: Record<string, string[]> = ${JSON.stringify(expected, null, 1)};
const MODS: string[] = ${JSON.stringify(MODULES)};

const moneyMod: any = await import("./shop/money.ts");
const asMoney = (c: unknown) => moneyMod.money(c);

function warningsOf(fn: () => unknown): string[] {
	const seen: string[] = [];
	const orig = process.emitWarning;
	(process as any).emitWarning = (msg: any, type?: any) => void seen.push(String(typeof type === "string" ? type : msg));
	try {
		fn();
	} finally {
		process.emitWarning = orig;
	}
	return seen;
}

test("every module's totals are unchanged, with no deprecation warning from them", async () => {
	for (const key of Object.keys(EXPECTED)) {
		const [mod, fn] = key.split(".");
		const m: any = await import(\`./shop/\${mod}.ts\`);
		const warns = warningsOf(() => {
			assert.equal(asMoney(m[fn]([[19.99, 3], [0.35, 0], [5, 7]], 2)), EXPECTED[key][0], key);
			assert.equal(asMoney(m[fn]([[100, 1]])), EXPECTED[key][1], key);
		});
		assert.deepEqual(warns, [], \`\${key} must not use the deprecated alias\`);
	}
});

test("no module other than money.ts mentions calcTotal; all use orderTotal", () => {
	for (const f of readdirSync("shop")) {
		if (f === "money.ts") continue;
		const src = readFileSync(join("shop", f), "utf8");
		assert.doesNotMatch(src, /calcTotal/, f);
		assert.match(src, /orderTotal/, f);
	}
});

test("orderTotal rejects a positional tax rate", () => {
	assert.equal(asMoney(moneyMod.orderTotal([[10, 2]], { taxRate: 0.5 })), "30.00");
	assert.throws(() => (moneyMod.orderTotal as any)([[10, 2]], 0.5), TypeError);
	assert.throws(() => (moneyMod.orderTotal as any)([[10, 2]]), TypeError);
});

test("calcTotal stays a deprecated alias with the same result", () => {
	let out: unknown;
	const warns = warningsOf(() => (out = moneyMod.calcTotal([[10, 2]], 0.5)));
	assert.equal(asMoney(out as bigint), "30.00");
	assert.ok(warns.some((x) => /DeprecationWarning/.test(x)), JSON.stringify(warns));
});

test("README and the visible test use orderTotal", () => {
	assert.match(readFileSync("README.md", "utf8"), /orderTotal/);
	assert.match(readFileSync(join("tests", "money.test.ts"), "utf8"), /orderTotal/);
});
`,
		);
		return { expected, checks: "" };
	},
};
