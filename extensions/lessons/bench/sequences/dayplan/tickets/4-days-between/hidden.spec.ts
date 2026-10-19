import assert from "node:assert/strict";
import { test } from "node:test";
import * as api from "../src/index.ts";
import { daysBetween } from "../src/daysBetween.ts";

const ZONES = ["UTC", "Pacific/Honolulu", "Pacific/Kiritimati", "America/New_York", "Europe/London"];
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

test("[utc] daysBetween in every time zone", () => {
	inZones(() => {
		assert.equal(daysBetween("2026-10-19", "2026-10-19"), 0);
		assert.equal(daysBetween("2026-10-19", "2026-10-26"), 7);
		assert.equal(daysBetween("2026-10-26", "2026-10-19"), -7);
		assert.equal(daysBetween("2026-03-01", "2026-04-01"), 31); // DST starts in between
		assert.equal(daysBetween("2026-10-20", "2026-11-03"), 14); // DST ends in between
		assert.equal(daysBetween("2026-01-01", "2027-01-01"), 365);
		assert.equal(daysBetween("2028-01-01", "2029-01-01"), 366);
	});
});

test("[behavior] daysBetween rejects bad days", () => {
	assert.throws(() => daysBetween("2026-10-19", "tomorrow"), { code: "INVALID_DAY" });
});

test("[index] daysBetween is in the public API", () => {
	assert.equal((api as any).daysBetween, daysBetween);
});
