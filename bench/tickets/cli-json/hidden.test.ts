import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { main } from "./src/inventory.ts";

const CSV = "name,qty,price\npear,3,0.5\napple,10,1.25\nbad,x,1\nfig,7,abc\ncherry,5,2\n";
function run(argv: string[], csv = CSV) {
	let out = "", err = "";
	const code = main(argv, { readFile: () => csv, out: (t) => void (out += t), err: (t) => void (err += t) });
	return { code, out, err };
}

test("json format: sorted array of typed objects", () => {
	const r = run(["items.csv", "--format", "json"]);
	assert.equal(r.code, 0);
	assert.ok(r.out.endsWith("\n"));
	assert.deepEqual(JSON.parse(r.out), [
		{ name: "apple", qty: 10, price: 1.25 },
		{ name: "cherry", qty: 5, price: 2 },
		{ name: "pear", qty: 3, price: 0.5 },
	]);
});

test("--min-qty filters json too, in any argument order", () => {
	const r = run(["--format", "json", "--min-qty", "5", "items.csv"]);
	assert.deepEqual(JSON.parse(r.out).map((x: any) => x.name), ["apple", "cherry"]);
});

test("bad rows: warning with the file line number, skipped in both formats", () => {
	for (const fmt of ["table", "json"]) {
		const r = run(["items.csv", "--format", fmt]);
		assert.equal(r.code, 0);
		assert.match(r.err, /skipping line 4:/);
		assert.match(r.err, /skipping line 5:/);
		assert.equal((r.err.match(/skipping line/g) ?? []).length, 2);
		assert.doesNotMatch(r.out, /bad|fig/);
	}
});

test("table stays the default", () => {
	const r = run(["items.csv"]);
	assert.equal(r.out.split("\n")[0], "apple                    10       1.25");
});

test("unknown format: exit 2 with a message on stderr", () => {
	const r = run(["items.csv", "--format", "xml"]);
	assert.equal(r.code, 2);
	assert.ok(r.err.length > 0);
	assert.equal(r.out, "");
});

test("README documents --format json and the warnings", () => {
	const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");
	assert.match(readme, /--format/);
	assert.match(readme, /json/i);
	assert.match(readme, /skipping|warning/i);
});
