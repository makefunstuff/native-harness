import assert from "node:assert/strict";
import { test } from "node:test";
import { LedgerError } from "../src/money.ts";
import { convertCents } from "../src/ops/fx.ts";
import { OPERATIONS } from "../src/registry.ts";

test("[behavior] convertCents", () => {
	assert.equal(convertCents(10000, 1.1), 11000);
	assert.equal(convertCents(1234, 1.1), 1357); // 1357.4
	assert.equal(convertCents(-1000, 0.9), -900);
	assert.equal(convertCents(0, 3), 0);
});

test("[rounding] convertCents rounds half to even", () => {
	assert.equal(convertCents(5, 0.5), 2); // 2.5
	assert.equal(convertCents(7, 0.5), 4); // 3.5
	assert.equal(convertCents(25, 0.1), 2); // 2.5000000000000004 in floating point
	assert.equal(convertCents(21, 0.5), 10); // 10.5
});

test("[error] convertCents errors are LedgerErrors with codes", () => {
	assert.throws(() => convertCents(1.5, 2), (e: any) => e instanceof LedgerError && e.code === "INVALID_AMOUNT");
	assert.throws(() => convertCents(100, 0), (e: any) => e instanceof LedgerError && e.code === "INVALID_RATE");
	assert.throws(() => convertCents(100, -2), (e: any) => e instanceof LedgerError && e.code === "INVALID_RATE");
	assert.throws(() => convertCents(100, Number.POSITIVE_INFINITY), (e: any) => e instanceof LedgerError && e.code === "INVALID_RATE");
});

test("[registry] convertCents is registered", () => {
	assert.equal(OPERATIONS.convertCents, convertCents);
});
