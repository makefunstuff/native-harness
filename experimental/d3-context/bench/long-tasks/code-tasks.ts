// The three code tickets of the long set: a long behaviour document whose rules the code must
// follow. Each has repo/, ref/ (the fix), and hidden tests that grade the final tree, so the ticket
// self-test (bench/lib/tickets.ts) can check that it discriminates.
import { lines, range, type Task, type Writer } from "./util.ts";

const PKG = (name: string) => `{\n  "name": "${name}",\n  "private": true,\n  "type": "module"\n}\n`;

// ── config-validator: four rules in a long document, four bugs in the code ─────────────────────
const VALIDATOR_REPO = `// Config validation for the ingest service. The rules are in docs/behaviour.md.
export type Severity = "ok" | "warn" | "error";

export interface Finding {
	key: string;
	severity: Severity;
	message: string;
}

export function validate(cfg: Record<string, any>): Finding[] {
	const out: Finding[] = [];
	const n = (k: string) => Number(cfg[k]);

	// rule 1: max_connections must be at least 10 and at most 500
	if (cfg.max_connections !== undefined) {
		if (n("max_connections") < 10) out.push({ key: "max_connections", severity: "warn", message: "below the minimum of 10" });
		if (n("max_connections") < 500) out.push({ key: "max_connections", severity: "error", message: "above the maximum of 500" });
	}

	// rule 2: flush_interval_s must be a whole number of seconds, at least 1
	if (cfg.flush_interval_s !== undefined && n("flush_interval_s") > 1) out.push({ key: "flush_interval_s", severity: "error", message: "must be at least 1" });

	// rule 3: a retention_days over 90 warns, over 365 is an error
	if (cfg.retention_days !== undefined) {
		if (n("retention_days") > 90) out.push({ key: "retention_days", severity: "warn", message: "over 90 days" });
		if (n("retention_days") > 365) out.push({ key: "retention_days", severity: "warn", message: "over 365 days" });
	}

	// rule 4: region must be known
	if (cfg.region !== undefined && !["eu", "us", "apac"].includes(String(cfg.region))) out.push({ key: "region", severity: "warn", message: \`unknown region \${cfg.region}\` });

	return out;
}

/** The overall severity: the worst finding, "ok" when there is none. */
export function worst(findings: Finding[]): Severity {
	if (!findings.length) return "ok";
	const order: Severity[] = ["ok", "warn", "error"];
	return findings.reduce((a, f) => (order.indexOf(f.severity) < order.indexOf(a) ? f.severity : a), "error" as Severity);
}
`;

const VALIDATOR_REF = `// Config validation for the ingest service. The rules are in docs/behaviour.md.
export type Severity = "ok" | "warn" | "error";

export interface Finding {
	key: string;
	severity: Severity;
	message: string;
}

export function validate(cfg: Record<string, any>): Finding[] {
	const out: Finding[] = [];
	const n = (k: string) => Number(cfg[k]);
	const push = (key: string, severity: Severity, message: string) => {
		// the worst finding for a key is the one that stays: an error wins over a warning
		const prev = out.find((f) => f.key === key);
		if (prev) {
			if (severity === "error" && prev.severity !== "error") out[out.indexOf(prev)] = { key, severity, message };
			return;
		}
		out.push({ key, severity, message });
	};

	// rule 1: below 10 is an error, above 500 is an error
	if (cfg.max_connections !== undefined) {
		if (n("max_connections") < 10) push("max_connections", "error", "below the minimum of 10");
		if (n("max_connections") > 500) push("max_connections", "error", "above the maximum of 500");
	}

	// rule 2: flush_interval_s must be a whole number of seconds, at least 1
	if (cfg.flush_interval_s !== undefined && (n("flush_interval_s") < 1 || !Number.isInteger(n("flush_interval_s"))))
		push("flush_interval_s", "error", "must be a whole number of seconds, at least 1");

	// rule 3: over 90 days warns, over 365 is an error
	if (cfg.retention_days !== undefined) {
		if (n("retention_days") > 365) push("retention_days", "error", "over 365 days");
		else if (n("retention_days") > 90) push("retention_days", "warn", "over 90 days");
	}

	// rule 4: an unknown region is an error
	if (cfg.region !== undefined && !["eu", "us", "apac"].includes(String(cfg.region))) push("region", "error", \`unknown region \${cfg.region}\`);

	return out;
}

/** The overall severity: the worst finding, "ok" when there is none. */
export function worst(findings: Finding[]): Severity {
	if (!findings.length) return "ok";
	const order: Severity[] = ["ok", "warn", "error"];
	return findings.reduce((a, f) => (order.indexOf(f.severity) > order.indexOf(a) ? f.severity : a), "ok" as Severity);
}
`;

export const configValidator: Task = {
	name: "config-validator",
	questions: [],
	build(w: Writer) {
		w("repo/package.json", PKG("ingest-config"));
		w("repo/src/validator.ts", VALIDATOR_REPO);
		w("ref/src/validator.ts", VALIDATOR_REF);
		w(
			"repo/docs/behaviour.md",
			lines([
				"# Config validation rules",
				"",
				range(20, (i) => `Context note ${i}: the service reads its configuration from \`.ci/params.json\`, and a rejected configuration stops the pipeline.`),
				"",
				"## Rule 1: max_connections",
				"",
				"`max_connections` must be at least 10 and at most 500. A value below 10 is an **error**",
				"(the service would starve), and a value above 500 is an **error** (the pool refuses it).",
				"Both bounds are inclusive: 10 and 500 are accepted.",
				"",
				"## Rule 2: flush_interval_s",
				"",
				"`flush_interval_s` must be a **whole number** of seconds and at least 1. A fraction (1.5) is",
				"an **error**; 0 is an **error**; 1 is accepted.",
				"",
				"## Rule 3: retention_days",
				"",
				"A `retention_days` over 90 is a **warning** (cost). Over 365 it is an **error** (the archive",
				"refuses it). 90 and 365 are accepted as they stand: 90 gives nothing, 365 gives a warning, and",
				"366 gives an error.",
				"",
				"## Rule 4: region",
				"",
				"`region` must be one of `eu`, `us`, `apac`. Anything else is an **error**.",
				"",
				"## Reporting",
				"",
				"Each rule gives at most one finding per key: the worst one (an error beats a warning).",
				"`worst(findings)` returns the worst severity of a list, and `ok` for an empty list.",
			]),
		);
		w(
			"repo/tests/validator.test.ts",
			`import assert from "node:assert/strict";
import { test } from "node:test";
import { validate, worst } from "../src/validator.ts";

test("an accepted config gives nothing", () => {
	assert.deepEqual(validate({ max_connections: 50, flush_interval_s: 5, retention_days: 30, region: "eu" }), []);
	assert.equal(worst([]), "ok");
});

test("the bounds are inclusive", () => {
	assert.deepEqual(validate({ max_connections: 10 }), []);
	assert.deepEqual(validate({ max_connections: 500 }), []);
	assert.deepEqual(validate({ retention_days: 90 }), []);
	assert.deepEqual(validate({ flush_interval_s: 1 }), []);
});
`,
		);
		w(
			"issue.md",
			lines([
				"`src/validator.ts` does not follow the rules in `docs/behaviour.md`. Fix the four rules so",
				"that the documented severities, bounds and the one-finding-per-key reporting are exactly as",
				"the document describes. Keep the exported names and the signatures.",
				"",
				"Do not change `docs/behaviour.md` or the tests.",
				"",
				"Run the tests with: node --test tests/*.test.ts",
			]),
		);
		w(
			"hidden.test.ts",
			`// Generated by gen-long-tasks.ts: do not edit.
import assert from "node:assert/strict";
import { test } from "node:test";
import { validate, worst } from "./src/validator.ts";

const sev = (cfg: any, key: string) => validate(cfg).find((f) => f.key === key)?.severity;

test("rule 1: max_connections, both bounds are errors, the bounds are inclusive", () => {
	assert.equal(sev({ max_connections: 9 }, "max_connections"), "error");
	assert.equal(sev({ max_connections: 501 }, "max_connections"), "error");
	assert.equal(sev({ max_connections: 10 }, "max_connections"), undefined);
	assert.equal(sev({ max_connections: 500 }, "max_connections"), undefined);
});

test("rule 2: flush_interval_s is a whole number of seconds, at least 1", () => {
	assert.equal(sev({ flush_interval_s: 0 }, "flush_interval_s"), "error");
	assert.equal(sev({ flush_interval_s: 1.5 }, "flush_interval_s"), "error");
	assert.equal(sev({ flush_interval_s: 1 }, "flush_interval_s"), undefined);
	assert.equal(sev({ flush_interval_s: 5 }, "flush_interval_s"), undefined);
});

test("rule 3: retention_days warns over 90, errors over 365", () => {
	assert.equal(sev({ retention_days: 91 }, "retention_days"), "warn");
	assert.equal(sev({ retention_days: 365 }, "retention_days"), "warn");
	assert.equal(sev({ retention_days: 366 }, "retention_days"), "error");
	assert.equal(sev({ retention_days: 90 }, "retention_days"), undefined);
});

test("rule 4: an unknown region is an error", () => {
	assert.equal(sev({ region: "mars" }, "region"), "error");
	assert.equal(sev({ region: "eu" }, "region"), undefined);
});

test("one finding per key, the worst one, and worst() over a list", () => {
	const f = validate({ max_connections: 9, retention_days: 400, region: "mars" });
	assert.equal(f.filter((x) => x.key === "max_connections").length, 1);
	assert.equal(worst(f), "error");
	assert.equal(worst([{ key: "a", severity: "warn", message: "" }]), "warn");
});
`,
		);
		return { expected: {}, checks: "" };
	},
};

// ── etl-pipeline: add the documented dedupe stage ──────────────────────────────────────────────
const ETL_STAGE_DOC = [
	"# The pipeline stages",
	"",
	"`run(rows)` reads, transforms, deduplicates, converts to the base currency and aggregates.",
	"",
	"## The dedupe stage (etl/dedupe.ts)",
	"",
	"`dedupe(rows: Row[]): Row[]` removes duplicates of `key`, keeping **one row per key**:",
	"the row with the **largest `ts`**; on equal `ts`, the **later** row in the input wins.",
	"The returned rows keep the order of their first appearance in the input.",
	"A row with no `key` (undefined, null or empty) is kept as it stands, and is never a duplicate.",
	"",
	range(14, (i) => `Context note ${i}: the input can be 100k rows; keep the stage linear.`),
].join("\n");

export const etlPipeline: Task = {
	name: "etl-pipeline",
	questions: [],
	build(w: Writer) {
		w("repo/package.json", PKG("etl"));
		w("repo/etl/types.ts", `export interface Row {\n\tkey?: string | null;\n\tts: number;\n\tamount: number;\n\tcurrency?: string;\n}\n`);
		w(
			"repo/etl/ingest.ts",
			`import type { Row } from "./types.ts";\n\n/** Rows from an array of objects; anything without an amount is dropped. */\nexport function ingest(raw: any[]): Row[] {\n\treturn raw.filter((r) => r && typeof r.amount === "number").map((r) => ({ key: r.id, ts: Number(r.ts) || 0, amount: Number(r.amount), currency: r.currency }));\n}\n`,
		);
		w(
			"repo/etl/fx.ts",
			`import type { Row } from "./types.ts";\n\nconst RATES: Record<string, number> = { EUR: 1.1, GBP: 1.25, USD: 1 };\n\n/** Amounts in the base currency, two decimals, half-up. Unknown currencies pass through. */\nexport function toBase(rows: Row[]): Row[] {\n\treturn rows.map((r) => (r.currency && RATES[r.currency] ? { ...r, amount: Math.round(r.amount * RATES[r.currency] * 100) / 100, currency: "USD" } : r));\n}\n`,
		);
		w(
			"repo/etl/aggregate.ts",
			`import type { Row } from "./types.ts";\n\n/** Totals per key, in the order of first appearance; keyless rows land under "-". */\nexport function totals(rows: Row[]): [string, number][] {\n\tconst out: [string, number][] = [];\n\tfor (const r of rows) {\n\t\tconst k = r.key || "-";\n\t\tconst hit = out.find((x) => x[0] === k);\n\t\tif (hit) hit[1] = Math.round((hit[1] + r.amount) * 100) / 100;\n\t\telse out.push([k, r.amount]);\n\t}\n\treturn out;\n}\n`,
		);
		w(
			"repo/etl/pipeline.ts",
			`import { ingest } from "./ingest.ts";\nimport { toBase } from "./fx.ts";\nimport { totals } from "./aggregate.ts";\nimport type { Row } from "./types.ts";\n\nexport function run(raw: any[]): [string, number][] {\n\tconst rows: Row[] = ingest(raw);\n\tconst clean = rows; // the dedupe stage is documented in docs/stages.md\n\treturn totals(toBase(clean));\n}\n`,
		);
		w("repo/docs/stages.md", ETL_STAGE_DOC);
		w(
			"repo/tests/pipeline.test.ts",
			`import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../etl/pipeline.ts";
import { ingest } from "../etl/ingest.ts";

test("rows without an amount are dropped", () => {
	assert.deepEqual(ingest([{ id: "a", ts: 1, amount: 1 }, { id: "b", ts: 1 }]), [{ key: "a", ts: 1, amount: 1, currency: undefined }]);
});

test("fx converts to the base currency", () => {
	assert.deepEqual(run([{ id: "a", ts: 1, amount: 10, currency: "EUR" }]), [["a", 11]]);
});
`,
		);
		w(
			"ref/etl/dedupe.ts",
			`import type { Row } from "./types.ts";\n\n/** One row per key: the largest ts wins, ties go to the later row. Keyless rows are kept. */\nexport function dedupe(rows: Row[]): Row[] {\n\tconst byKey = new Map<string, Row>();\n\tconst out: Row[] = [];\n\tfor (const r of rows) {\n\t\tif (!r.key) {\n\t\t\tout.push(r);\n\t\t\tcontinue;\n\t\t}\n\t\tconst prev = byKey.get(r.key);\n\t\tif (!prev) {\n\t\t\tbyKey.set(r.key, r);\n\t\t\tout.push(r);\n\t\t} else if (r.ts >= prev.ts) byKey.set(r.key, r);\n\t}\n\treturn out.map((r) => (r.key ? byKey.get(r.key)! : r));\n}\n`,
		);
		w(
			"ref/etl/pipeline.ts",
			`import { ingest } from "./ingest.ts";\nimport { dedupe } from "./dedupe.ts";\nimport { toBase } from "./fx.ts";\nimport { totals } from "./aggregate.ts";\nimport type { Row } from "./types.ts";\n\nexport function run(raw: any[]): [string, number][] {\n\tconst rows: Row[] = ingest(raw);\n\tconst clean = dedupe(rows);\n\treturn totals(toBase(clean));\n}\n`,
		);
		w(
			"issue.md",
			lines([
				"The pipeline is missing its dedupe stage: `docs/stages.md` documents `etl/dedupe.ts` with",
				"`dedupe(rows)`, and `etl/pipeline.ts` has the place where it belongs.",
				"",
				"Add `etl/dedupe.ts` and wire it into the pipeline, exactly as the document describes.",
				"Keep the other stages as they are, and do not change `docs/stages.md`.",
				"",
				"Run the tests with: node --test tests/*.test.ts",
			]),
		);
		w(
			"hidden.test.ts",
			`// Generated by gen-long-tasks.ts: do not edit.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupe } from "./etl/dedupe.ts";
import { run } from "./etl/pipeline.ts";

test("one row per key, the largest ts wins", () => {
	const rows = [
		{ key: "a", ts: 1, amount: 10 },
		{ key: "b", ts: 5, amount: 1 },
		{ key: "a", ts: 3, amount: 20 },
		{ key: "a", ts: 2, amount: 30 },
	];
	assert.deepEqual(dedupe(rows), [
		{ key: "a", ts: 3, amount: 20 },
		{ key: "b", ts: 5, amount: 1 },
	]);
});

test("equal ts: the later row wins, and the order is the order of first appearance", () => {
	const rows = [{ key: "x", ts: 7, amount: 1 }, { key: "y", ts: 1, amount: 2 }, { key: "x", ts: 7, amount: 99 }];
	assert.deepEqual(dedupe(rows), [
		{ key: "x", ts: 7, amount: 99 },
		{ key: "y", ts: 1, amount: 2 },
	]);
});

test("rows without a key are kept, and are never duplicates", () => {
	const rows = [{ ts: 1, amount: 5 }, { ts: 2, amount: 6 }, { key: "", ts: 3, amount: 7 }, { key: null, ts: 4, amount: 8 }];
	assert.equal(dedupe(rows).length, 4);
});

test("the pipeline deduplicates before it aggregates", () => {
	const raw = [
		{ id: "a", ts: 1, amount: 10, currency: "EUR" },
		{ id: "a", ts: 2, amount: 20, currency: "EUR" },
		{ id: "b", ts: 1, amount: 4, currency: "USD" },
	];
	assert.deepEqual(run(raw), [
		["a", 22],
		["b", 4],
	]);
});
`,
		);
		return { expected: {}, checks: "" };
	},
};

// ── api-v2-migration: v1 stays, v2 is added ────────────────────────────────────────────────────
export const apiV2Migration: Task = {
	name: "api-v2-migration",
	questions: [],
	build(w: Writer) {
		w("repo/package.json", PKG("api"));
		w(
			"repo/src/store.ts",
			`export interface Item {\n\tid: string;\n\tname: string;\n\tsku: string;\n\tqty: number;\n\tprice: number;\n}\n\nconst items = new Map<string, Item>();\n\nexport function put(item: Item) {\n\titems.set(item.id, item);\n}\nexport function get(id: string): Item | undefined {\n\treturn items.get(id);\n}\nexport function all(): Item[] {\n\treturn [...items.values()];\n}\nexport function clear() {\n\titems.clear();\n}\n`,
		);
		w(
			"repo/src/registry.ts",
			`const routes = new Map<string, (params: any) => any>();\n\nexport function add(method: string, path: string, handler: (params: any) => any) {\n\troutes.set(\`\${method} \${path}\`, handler);\n}\nexport function find(method: string, path: string) {\n\treturn routes.get(\`\${method} \${path}\`);\n}\nexport function call(method: string, path: string, params: any) {\n\tconst h = find(method, path);\n\tif (!h) throw new Error(\`no route \${method} \${path}\`);\n\treturn h(params);\n}\n`,
		);
		w(
			"repo/src/api.ts",
			`import { all, get, put, type Item } from "./store.ts";\nimport { add, call } from "./registry.ts";\n\n/** v1: flat snake_case payloads. */\nadd("GET", "/v1/items", () => all().map((i) => ({ id: i.id, name: i.name, sku: i.sku, qty: i.qty, price: i.price })));\nadd("GET", "/v1/items/:id", (p) => get(p.id) ?? null);\nadd("POST", "/v1/items", (p) => {\n\tput(p as Item);\n\treturn { ok: true };\n});\n\nexport { call };\n`,
		);
		w(
			"repo/docs/v2.md",
			lines([
				"# The v2 surface",
				"",
				"v2 is added next to v1; v1 keeps working exactly as it is.",
				"",
				"- `GET /v2/items` returns `{ data: [...], meta: { count: <number> } }`. Each item is",
				"  `{ id, name, sku, quantity, unitPrice }`: `qty` becomes `quantity`, `price` becomes",
				"  `unitPrice`, and `meta.count` is the number of items.",
				"- `GET /v2/items/:id` returns `{ data: <item> }`, and `{ data: null }` when it is missing.",
				"- `POST /v2/items` accepts the v2 shape (`quantity`, `unitPrice`) and stores it; it returns",
				"  `{ data: { ok: true } }`.",
				"- Every v2 response carries the v1 data too, so a client can migrate one field at a time:",
				"  an item under v2 keeps `qty` and `price` with the same values.",
				"",
				range(12, (i) => `Context note ${i}: the mobile clients read v1 today and cannot be changed at the same time as the server.`),
			]),
		);
		w(
			"repo/tests/api.test.ts",
			`import assert from "node:assert/strict";
import { test } from "node:test";
import { call } from "../src/api.ts";
import { clear } from "../src/store.ts";

test("v1 items list", () => {
	clear();
	call("POST", "/v1/items", { id: "1", name: "bolt", sku: "B-1", qty: 3, price: 0.5 });
	const list = call("GET", "/v1/items", {});
	assert.deepEqual(list, [{ id: "1", name: "bolt", sku: "B-1", qty: 3, price: 0.5 }]);
});
`,
		);
		w(
			"ref/src/api.ts",
			`import { all, get, put, type Item } from "./store.ts";\nimport { add, call } from "./registry.ts";\n\n/** v1: flat snake_case payloads. */\nadd("GET", "/v1/items", () => all().map((i) => ({ id: i.id, name: i.name, sku: i.sku, qty: i.qty, price: i.price })));\nadd("GET", "/v1/items/:id", (p) => get(p.id) ?? null);\nadd("POST", "/v1/items", (p) => {\n\tput(p as Item);\n\treturn { ok: true };\n});\n\nconst v2 = (i: Item) => ({ id: i.id, name: i.name, sku: i.sku, quantity: i.qty, unitPrice: i.price, qty: i.qty, price: i.price });\n\n/** v2: a data envelope, renamed fields, and the v1 names kept alongside. */\nadd("GET", "/v2/items", () => {\n\tconst data = all().map(v2);\n\treturn { data, meta: { count: data.length } };\n});\nadd("GET", "/v2/items/:id", (p) => ({ data: get(p.id) ? v2(get(p.id)!) : null }));\nadd("POST", "/v2/items", (p) => {\n\tput({ id: p.id, name: p.name, sku: p.sku, qty: Number(p.quantity), price: Number(p.unitPrice) });\n\treturn { data: { ok: true } };\n});\n\nexport { call };\n`,
		);
		w(
			"issue.md",
			lines([
				"Add the v2 surface documented in `docs/v2.md` to `src/api.ts` (the registry and the store",
				"are already there). v1 must keep working exactly as it does today.",
				"",
				"Do not change `docs/v2.md` or the tests.",
				"",
				"Run the tests with: node --test tests/*.test.ts",
			]),
		);
		w(
			"hidden.test.ts",
			`// Generated by gen-long-tasks.ts: do not edit.
import assert from "node:assert/strict";
import { test } from "node:test";
import { call } from "./src/api.ts";
import { clear, get } from "./src/store.ts";

const seed = () => {
	clear();
	call("POST", "/v1/items", { id: "1", name: "bolt", sku: "B-1", qty: 3, price: 0.5 });
	call("POST", "/v1/items", { id: "2", name: "nut", sku: "N-2", qty: 10, price: 0.1 });
};

test("v1 is unchanged", () => {
	seed();
	assert.deepEqual(call("GET", "/v1/items", {}), [
		{ id: "1", name: "bolt", sku: "B-1", qty: 3, price: 0.5 },
		{ id: "2", name: "nut", sku: "N-2", qty: 10, price: 0.1 },
	]);
	assert.equal(call("GET", "/v1/items/:id", { id: "nope" }), null);
});

test("the v2 list is an envelope with renamed fields and a count", () => {
	seed();
	const r = call("GET", "/v2/items", {});
	assert.equal(r.meta.count, 2);
	assert.equal(r.data.length, 2);
	assert.equal(r.data[0].quantity, 3);
	assert.equal(r.data[0].unitPrice, 0.5);
});

test("v2 keeps the v1 names, with the same values", () => {
	seed();
	const r = call("GET", "/v2/items", {});
	assert.equal(r.data[0].qty, 3);
	assert.equal(r.data[0].price, 0.5);
});

test("v2 one item, and null for a missing one", () => {
	seed();
	assert.equal(call("GET", "/v2/items/:id", { id: "2" }).data.sku, "N-2");
	assert.equal(call("GET", "/v2/items/:id", { id: "zz" }).data, null);
});

test("POST /v2/items takes the v2 shape and stores it", () => {
	seed();
	assert.deepEqual(call("POST", "/v2/items", { id: "3", name: "washer", sku: "W-3", quantity: 4, unitPrice: 2 }), { data: { ok: true } });
	assert.deepEqual(get("3"), { id: "3", name: "washer", sku: "W-3", qty: 4, price: 2 });
});
`,
		);
		return { expected: {}, checks: "" };
	},
};
