import assert from "node:assert/strict";
import test from "node:test";
import { computeMaxLoad } from "../src/sweep.ts";

test("two overlapping intervals", () => {
	assert.deepEqual(computeMaxLoad([[0, 10, 1], [5, 15, 2]]), { maxLoad: 3, spans: [[5, 10]] });
});
