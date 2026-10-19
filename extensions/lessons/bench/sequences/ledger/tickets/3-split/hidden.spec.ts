import assert from "node:assert/strict";
import { test } from "node:test";
import { LedgerError } from "../src/money.ts";
import { splitEvenly } from "../src/ops/split.ts";
import { OPERATIONS } from "../src/registry.ts";

test("[behavior] splitEvenly", () => {
	assert.deepEqual(splitEvenly(100, 3), [34, 33, 33]);
	assert.deepEqual(splitEvenly(5, 5), [1, 1, 1, 1, 1]);
	assert.deepEqual(splitEvenly(2, 3), [1, 1, 0]);
	assert.deepEqual(splitEvenly(0, 2), [0, 0]);
	assert.deepEqual(splitEvenly(1001, 1), [1001]);
});

test("[error] splitEvenly errors are LedgerErrors with codes", () => {
	assert.throws(() => splitEvenly(-1, 2), (e: any) => e instanceof LedgerError && e.code === "NEGATIVE_AMOUNT");
	assert.throws(() => splitEvenly(10, 0), (e: any) => e instanceof LedgerError && e.code === "INVALID_PARTS");
	assert.throws(() => splitEvenly(10, 2.5), (e: any) => e instanceof LedgerError && e.code === "INVALID_PARTS");
});

test("[registry] splitEvenly is registered", () => {
	assert.equal(OPERATIONS.splitEvenly, splitEvenly);
});
