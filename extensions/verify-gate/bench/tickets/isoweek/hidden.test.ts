import assert from "node:assert/strict";
import test from "node:test";
import { formatWeek, isoWeek, weeksInYear } from "./src/isoweek.ts";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

// Known values (from published ISO week calendars).
test("New Year boundaries", () => {
	const cases: Array<[Date, number, number]> = [
		[d(2026, 1, 1), 2026, 1], // Thursday
		[d(2025, 12, 29), 2026, 1], // Monday
		[d(2027, 1, 1), 2026, 53], // Friday
		[d(2027, 1, 3), 2026, 53], // Sunday
		[d(2027, 1, 4), 2027, 1], // Monday
		[d(2024, 12, 30), 2025, 1],
		[d(2021, 1, 3), 2020, 53],
		[d(2021, 1, 4), 2021, 1],
		[d(2020, 12, 31), 2020, 53],
		[d(2023, 1, 1), 2022, 52],
		[d(2023, 1, 2), 2023, 1],
		[d(2008, 12, 29), 2009, 1],
		[d(2010, 1, 3), 2009, 53],
	];
	for (const [date, year, week] of cases) assert.deepEqual(isoWeek(date), { year, week }, date.toISOString());
});

test("weeksInYear", () => {
	for (const y of [2004, 2009, 2015, 2020, 2026, 2032, 2037]) assert.equal(weeksInYear(y), 53, String(y));
	for (const y of [2019, 2021, 2022, 2023, 2024, 2025, 2027]) assert.equal(weeksInYear(y), 52, String(y));
});

test("uses the UTC day, not local time", () => {
	assert.deepEqual(isoWeek(new Date("2026-12-31T23:59:59Z")), { year: 2026, week: 53 });
	assert.deepEqual(isoWeek(new Date("2027-01-04T00:00:00Z")), { year: 2027, week: 1 });
});

test("every day 2000-2040: weeks run Monday to Sunday and number consecutively", () => {
	let prev = isoWeek(d(1999, 12, 31));
	for (let t = Date.UTC(2000, 0, 1); t < Date.UTC(2041, 0, 1); t += 86_400_000) {
		const date = new Date(t);
		const cur = isoWeek(date);
		if (date.getUTCDay() === 1) {
			const expected = prev.week === weeksInYear(prev.year) ? { year: prev.year + 1, week: 1 } : { year: prev.year, week: prev.week + 1 };
			assert.deepEqual(cur, expected, date.toISOString());
		} else assert.deepEqual(cur, prev, date.toISOString());
		prev = cur;
	}
});

test("formatWeek", () => {
	assert.equal(formatWeek(d(2027, 1, 1)), "2026-W53");
	assert.equal(formatWeek(d(2026, 2, 12)), "2026-W07");
	assert.equal(formatWeek(d(2024, 12, 30)), "2025-W01");
});
