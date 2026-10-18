import assert from "node:assert/strict";
import { test } from "node:test";
import { percentOf } from "../src/ops/percent.ts";
import { sumCents } from "../src/ops/sum.ts";

test("percentOf rounds half to even", () => {
	assert.equal(percentOf(1000, 15), 150);
	assert.equal(percentOf(25, 10), 2); // 2.5 → 2
	assert.equal(percentOf(35, 10), 4); // 3.5 → 4
	assert.throws(() => percentOf(10, Number.NaN), { code: "INVALID_PERCENT" });
});

test("sumCents adds integer cents", () => {
	assert.equal(sumCents([100, 250, -50]), 300);
	assert.throws(() => sumCents([1.5]), { code: "INVALID_AMOUNT" });
});
