import assert from "node:assert/strict";
import { test } from "node:test";
import * as api from "../src/index.ts";
import { addBusinessDays } from "../src/businessDays.ts";

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

test("[utc] addBusinessDays in every time zone", () => {
	inZones(() => {
		assert.equal(addBusinessDays("2026-10-16", 1), "2026-10-19"); // Fri → Mon
		assert.equal(addBusinessDays("2026-10-19", -1), "2026-10-16");
		assert.equal(addBusinessDays("2026-10-17", 1), "2026-10-19"); // Sat → Mon
		assert.equal(addBusinessDays("2026-12-31", 2), "2027-01-04");
		assert.equal(addBusinessDays("2026-10-14", 0), "2026-10-14");
		assert.equal(addBusinessDays("2026-10-19", 10), "2026-11-02");
		assert.equal(addBusinessDays("2026-03-02", -5), "2026-02-23");
	});
});

test("[behavior] addBusinessDays rejects bad days", () => {
	assert.throws(() => addBusinessDays("2026-13-01", 1), { code: "INVALID_DAY" });
});

test("[index] addBusinessDays is in the public API", () => {
	assert.equal((api as any).addBusinessDays, addBusinessDays);
});
