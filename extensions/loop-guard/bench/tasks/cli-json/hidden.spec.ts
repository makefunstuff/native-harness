import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "./inventory.ts";

function run(csv: string, args: string[]) {
	const f = join(mkdtempSync(join(tmpdir(), "inv-")), "s.csv");
	writeFileSync(f, csv);
	const out: string[] = [], err: string[] = [];
	const code = main([f, ...args], { out: (l) => out.push(l), err: (l) => err.push(l) });
	return { code, out, err };
}

const CSV = "name,qty,price\nnut,2,0.1\nbolt,10,0.25\nwasher,7,0.05\n";

test("json sorted with types", () => {
	const r = run(CSV, ["--format", "json"]);
	assert.equal(r.code, 0);
	assert.equal(r.out.length, 1);
	assert.deepEqual(JSON.parse(r.out[0]), [
		{ name: "bolt", qty: 10, price: 0.25 },
		{ name: "nut", qty: 2, price: 0.1 },
		{ name: "washer", qty: 7, price: 0.05 },
	]);
});

test("min-qty applies to json", () => {
	const r = run(CSV, ["--format", "json", "--min-qty", "5"]);
	assert.deepEqual(JSON.parse(r.out.join("")).map((x: any) => x.name), ["bolt", "washer"]);
});

test("table stays the default", () => {
	const r = run(CSV, ["--min-qty", "5"]);
	assert.equal(r.code, 0);
	assert.equal(r.out.length, 2);
	assert.match(r.out[0], /^nut|^bolt/);
});

test("unknown format exits 2", () => {
	const r = run(CSV, ["--format", "xml"]);
	assert.equal(r.code, 2);
	assert.equal(r.out.length, 0);
	assert.ok(r.err.length > 0);
});

test("bad rows skipped with a warning, both formats", () => {
	const csv = "name,qty,price\nbolt,10,0.25\nbad,x,1\nnut,2,\nok,1,1.5\n";
	for (const fmt of ["json", "table"]) {
		const r = run(csv, ["--format", fmt]);
		assert.equal(r.code, 0);
		assert.deepEqual(r.err.filter((l) => /^skipping row/.test(l)).map((l) => l.match(/^skipping row (\d+)/)![1]), ["2", "3"], fmt);
	}
	assert.deepEqual(JSON.parse(run(csv, ["--format", "json"]).out[0]).map((x: any) => x.name), ["bolt", "ok"]);
});

test("README documents --format", () => {
	assert.match(readFileSync("README.md", "utf8"), /--format/);
});
