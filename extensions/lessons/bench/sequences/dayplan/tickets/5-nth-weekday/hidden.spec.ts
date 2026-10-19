import assert from "node:assert/strict";
import { test } from "node:test";
import * as api from "../src/index.ts";
import { DayError } from "../src/dates.ts";
import { nthWeekdayOfMonth } from "../src/nthWeekday.ts";

const ZONES = ["UTC", "Pacific/Honolulu", "Pacific/Kiritimati", "America/New_York"];
function inZones(fn: () => void) {
	const saved = process.env.TZ;
	try {
		for (const z of ZONES) {
			process.env.TZ = z;
			fn();
		}
	} finally {
		process.env.TZ = saved;
	}
}

test("[utc] nthWeekdayOfMonth in every time zone", () => {
	inZones(() => {
		assert.equal(nthWeekdayOfMonth(2026, 3, 2, 2), "2026-03-10"); // 2nd Tuesday
		assert.equal(nthWeekdayOfMonth(2026, 10, 1, 1), "2026-10-05"); // 1st Monday
		assert.equal(nthWeekdayOfMonth(2026, 10, 5, -1), "2026-10-30"); // last Friday
		assert.equal(nthWeekdayOfMonth(2026, 11, 4, 4), "2026-11-26"); // 4th Thursday
		assert.equal(nthWeekdayOfMonth(2026, 2, 0, -1), "2026-02-22"); // last Sunday
		assert.equal(nthWeekdayOfMonth(2026, 8, 6, 5), "2026-08-29"); // 5th Saturday
	});
});

test("[behavior] nthWeekdayOfMonth: a missing fifth weekday is a DayError", () => {
	assert.throws(() => nthWeekdayOfMonth(2026, 2, 1, 5), (e: any) => e instanceof DayError && e.code === "NO_SUCH_DAY");
});

test("[index] nthWeekdayOfMonth is in the public API", () => {
	assert.equal((api as any).nthWeekdayOfMonth, nthWeekdayOfMonth);
});
