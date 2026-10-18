import assert from "node:assert/strict";
import { test } from "node:test";
import { computeMaxLoad } from "../sweep.ts";

test("single reservation", () => {
	assert.deepEqual(computeMaxLoad([[0, 5, 2]]), [2, [[0, 5]]]);
});

test("empty", () => {
	assert.deepEqual(computeMaxLoad([]), [0, []]);
});
