import assert from "node:assert/strict";
import { test } from "node:test";
import { LedgerError } from "../src/money.ts";
import { simpleInterest } from "../src/ops/interest.ts";
import { OPERATIONS } from "../src/registry.ts";

test("[behavior] simpleInterest", () => {
	assert.equal(simpleInterest(36500, 10, 365), 3650);
	assert.equal(simpleInterest(36500, 10, 1), 10);
	assert.equal(simpleInterest(100000, 0, 30), 0);
	assert.equal(simpleInterest(100000, 5, 0), 0);
});

test("[rounding] simpleInterest rounds half to even", () => {
	assert.equal(simpleInterest(1825, 10, 365), 182); // 182.5
	assert.equal(simpleInterest(1835, 10, 365), 184); // 183.5
	assert.equal(simpleInterest(73000, 1, 9), 18); // 18.0
	assert.equal(simpleInterest(7300, 5, 5), 5); // 5.0
	assert.equal(simpleInterest(14600, 5, 9), 18); // 18.0
	assert.equal(simpleInterest(2920, 25, 1), 2); // 2.0
	assert.equal(simpleInterest(3650, 5, 5), 2); // 2.5
});

test("[error] simpleInterest errors are LedgerErrors with codes", () => {
	assert.throws(() => simpleInterest(-1, 5, 10), (e: any) => e instanceof LedgerError && e.code === "NEGATIVE_AMOUNT");
	assert.throws(() => simpleInterest(100, 5, -1), (e: any) => e instanceof LedgerError && e.code === "INVALID_DAYS");
	assert.throws(() => simpleInterest(100, 5, 1.5), (e: any) => e instanceof LedgerError && e.code === "INVALID_DAYS");
	assert.throws(() => simpleInterest(100, -5, 10), (e: any) => e instanceof LedgerError && e.code === "INVALID_RATE");
});

test("[registry] simpleInterest is registered", () => {
	assert.equal(OPERATIONS.simpleInterest, simpleInterest);
});
