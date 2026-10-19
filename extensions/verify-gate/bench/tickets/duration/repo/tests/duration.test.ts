import assert from "node:assert/strict";
import test from "node:test";
import { parseDuration } from "../src/duration.ts";

test("single units", () => {
	assert.equal(parseDuration("90s"), 90_000);
	assert.equal(parseDuration("2h"), 7_200_000);
});
