import assert from "node:assert/strict";
import test from "node:test";
import { formatWeek, isoWeek } from "../src/isoweek.ts";

test("a mid-February day", () => {
	assert.deepEqual(isoWeek(new Date(Date.UTC(2026, 1, 12))), { year: 2026, week: 7 });
	assert.equal(formatWeek(new Date(Date.UTC(2026, 1, 12))), "2026-W07");
});
