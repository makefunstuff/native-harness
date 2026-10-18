import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { invoiceTotal, lineTotal } from "./billing/invoice.ts";

test("half up on the exact decimal value", () => {
	assert.equal(lineTotal(1, "1.005"), 101);
	assert.equal(lineTotal(1, "1.015"), 102);
	assert.equal(lineTotal(2, "1.005"), 201);
	assert.equal(lineTotal(1, "0.125"), 13);
	assert.equal(lineTotal(3, "0.3333"), 100);
	assert.equal(lineTotal(1, "2"), 200);
	assert.equal(lineTotal(0, "5.5"), 0);
});

test("total sums rounded lines", () => {
	assert.equal(invoiceTotal([[1, "0.005"], [1, "0.005"]]), 2);
	assert.equal(invoiceTotal([]), 0);
});

test("bad input throws RangeError", () => {
	for (const [q, p] of [[-1, "2"], [1.5, "2"], [1, "abc"], [1, "-1"], [1, "1e3"], [1, ""]] as Array<[number, string]>)
		assert.throws(() => lineTotal(q, p), RangeError, `${q} x ${p}`);
	assert.throws(() => invoiceTotal([[1, "1"], [-2, "1"]]), RangeError);
});

test("layout kept", () => {
	assert.ok(existsSync("billing/invoice.ts"));
	assert.ok(!existsSync("src/billing/invoice.ts"));
});
