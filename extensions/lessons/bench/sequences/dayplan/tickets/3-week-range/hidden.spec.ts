import assert from "node:assert/strict";
import { test } from "node:test";
import * as api from "../src/index.ts";
import { isoWeekRange } from "../src/weekRange.ts";

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

test("[utc] isoWeekRange in every time zone", () => {
	inZones(() => {
		assert.deepEqual(isoWeekRange("2026-10-19"), ["2026-10-19", "2026-10-25"]); // Monday
		assert.deepEqual(isoWeekRange("2026-10-18"), ["2026-10-12", "2026-10-18"]); // Sunday
		assert.deepEqual(isoWeekRange("2026-10-22"), ["2026-10-19", "2026-10-25"]);
		assert.deepEqual(isoWeekRange("2027-01-01"), ["2026-12-28", "2027-01-03"]);
		assert.deepEqual(isoWeekRange("2026-03-01"), ["2026-02-23", "2026-03-01"]);
	});
});

test("[behavior] isoWeekRange rejects bad days", () => {
	assert.throws(() => isoWeekRange("2026-1-1"), { code: "INVALID_DAY" });
});

test("[index] isoWeekRange is in the public API", () => {
	assert.equal((api as any).isoWeekRange, isoWeekRange);
});
