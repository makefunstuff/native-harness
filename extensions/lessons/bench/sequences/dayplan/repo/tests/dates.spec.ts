import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, parseDay, weekday } from "../src/index.ts";

process.env.TZ = "Pacific/Honolulu"; // the scheduler runs in every time zone

test("addDays crosses months and years", () => {
	assert.equal(addDays("2026-01-31", 1), "2026-02-01");
	assert.equal(addDays("2026-12-31", 1), "2027-01-01");
	assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("weekday", () => {
	assert.equal(weekday("2026-10-19"), 1); // Monday
	assert.equal(weekday("2026-10-18"), 0); // Sunday
});

test("parseDay rejects bad days", () => {
	assert.throws(() => parseDay("2026-02-30"), { code: "INVALID_DAY" });
	assert.throws(() => parseDay("19.10.2026"), { code: "INVALID_DAY" });
});
