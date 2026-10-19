import assert from "node:assert/strict";
import { test } from "node:test";
import { LedgerError } from "../src/money.ts";
import { applyDiscount } from "../src/ops/discount.ts";
import { OPERATIONS } from "../src/registry.ts";

test("[behavior] applyDiscount", () => {
	assert.equal(applyDiscount(10000, 15), 8500);
	assert.equal(applyDiscount(999, 0), 999);
	assert.equal(applyDiscount(999, 100), 0);
});

test("[rounding] the discount is rounded half to even", () => {
	assert.equal(applyDiscount(25, 10), 23); // discount 2.5 → 2
	assert.equal(applyDiscount(35, 10), 31); // discount 3.5 → 4
	assert.equal(applyDiscount(1050, 5), 998); // discount 52.5 → 52
});

test("[error] applyDiscount errors are LedgerErrors with codes", () => {
	assert.throws(() => applyDiscount(-5, 10), (e: any) => e instanceof LedgerError && e.code === "NEGATIVE_AMOUNT");
	assert.throws(() => applyDiscount(100, 120), (e: any) => e instanceof LedgerError && e.code === "INVALID_PERCENT");
	assert.throws(() => applyDiscount(100, -3), (e: any) => e instanceof LedgerError && e.code === "INVALID_PERCENT");
});

test("[registry] applyDiscount is registered", () => {
	assert.equal(OPERATIONS.applyDiscount, applyDiscount);
});
