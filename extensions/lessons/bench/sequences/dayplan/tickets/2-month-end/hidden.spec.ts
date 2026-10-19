import assert from "node:assert/strict";
import { test } from "node:test";
import * as api from "../src/index.ts";
import { endOfMonth, isLastDayOfMonth } from "../src/monthEnd.ts";

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

test("[utc] endOfMonth and isLastDayOfMonth in every time zone", () => {
	inZones(() => {
		assert.equal(endOfMonth("2026-02-10"), "2026-02-28");
		assert.equal(endOfMonth("2028-02-01"), "2028-02-29");
		assert.equal(endOfMonth("2026-12-31"), "2026-12-31");
		assert.equal(endOfMonth("2026-04-01"), "2026-04-30");
		assert.equal(endOfMonth("2026-03-31"), "2026-03-31");
		assert.equal(isLastDayOfMonth("2026-04-30"), true);
		assert.equal(isLastDayOfMonth("2026-03-30"), false);
		assert.equal(isLastDayOfMonth("2028-02-29"), true);
		assert.equal(isLastDayOfMonth("2026-01-01"), false);
	});
});

test("[behavior] endOfMonth rejects bad days", () => {
	assert.throws(() => endOfMonth("2026-02-30"), { code: "INVALID_DAY" });
});

test("[index] endOfMonth and isLastDayOfMonth are in the public API", () => {
	assert.equal((api as any).endOfMonth, endOfMonth);
	assert.equal((api as any).isLastDayOfMonth, isLastDayOfMonth);
});
