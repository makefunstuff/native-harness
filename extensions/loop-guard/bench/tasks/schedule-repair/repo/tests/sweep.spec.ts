import assert from "node:assert/strict";
import { test } from "node:test";
import { computeMaxLoad } from "../sweep.ts";

test("empty", () => {
	assert.deepEqual(computeMaxLoad([]), [0, []]);
});

test("end before start", () => {
	assert.throws(() => computeMaxLoad([[5, 2, 1]]), RangeError);
});
