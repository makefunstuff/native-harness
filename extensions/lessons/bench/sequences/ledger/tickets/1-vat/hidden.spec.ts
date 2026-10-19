import assert from "node:assert/strict";
import { test } from "node:test";
import { LedgerError } from "../src/money.ts";
import { vatFor } from "../src/ops/vat.ts";
import { OPERATIONS } from "../src/registry.ts";

test("[behavior] vatFor", () => {
	assert.equal(vatFor(10000, 20), 2000);
	assert.equal(vatFor(999, 0), 0);
	assert.equal(vatFor(1999, 100), 1999);
});

test("[rounding] vatFor rounds half to even", () => {
	assert.equal(vatFor(1025, 10), 102); // 102.5
	assert.equal(vatFor(1035, 10), 104); // 103.5
	assert.equal(vatFor(5, 50), 2); // 2.5
	assert.equal(vatFor(333, 21), 70); // 69.93
});

test("[error] vatFor errors are LedgerErrors with codes", () => {
	assert.throws(() => vatFor(-1, 20), (e: any) => e instanceof LedgerError && e.code === "NEGATIVE_AMOUNT");
	assert.throws(() => vatFor(100, 101), (e: any) => e instanceof LedgerError && e.code === "INVALID_RATE");
	assert.throws(() => vatFor(100, -1), (e: any) => e instanceof LedgerError && e.code === "INVALID_RATE");
});

test("[registry] vatFor is registered", () => {
	assert.equal(OPERATIONS.vatFor, vatFor);
});
