import assert from "node:assert/strict";
import test from "node:test";
import { summarize } from "./src/logstats.ts";

const line = (ts: string, ms = 10, status = "200") => `${ts} GET /x ${status} ${ms}ms`;

test("hours are UTC hours, offsets applied", () => {
	const s = summarize([
		line("2026-10-12T23:30:00+02:00"),
		line("2026-10-12T21:10:00Z"),
		line("2026-10-12T18:00:00-05:30"),
		line("2026-10-13T01:15:00+03:00"),
		line("2026-12-31T22:30:00-02:00"),
	]);
	assert.deepEqual(s.byHourUtc, { "2026-10-12T21": 2, "2026-10-12T23": 1, "2026-10-12T22": 1, "2027-01-01T00": 1 });
	assert.equal(s.count, 5);
});

test("p95 is the nearest-rank percentile", () => {
	const lines = (n: number) => Array.from({ length: n }, (_, i) => line("2026-10-12T10:00:00Z", n - i));
	assert.equal(summarize(lines(20)).p95Ms, 19);
	assert.equal(summarize(lines(21)).p95Ms, 20);
	assert.equal(summarize(lines(100)).p95Ms, 95);
	assert.equal(summarize(lines(1)).p95Ms, 1);
	assert.equal(summarize(lines(10)).p95Ms, 10);
	assert.equal(summarize([]).p95Ms, null);
});

test("malformed lines are skipped and counted", () => {
	const s = summarize([
		line("2026-10-12T10:00:00Z", 5),
		"garbage",
		"2026-10-12T10:00:00Z GET /x 200 123",
		"2026-10-12T10:00:00Z GET /x abc 12ms",
		"2026-10-12T10:00:00Z GET /x 200 12ms extra",
		"2026-13-40T10:00:00Z GET /x 200 12ms",
		"2026-10-12 10:00:00 GET /x 200 12ms",
		"2026-10-12T10:00:00Z GET /x 200 1.5ms",
		line("2026-10-12T11:00:00+01:00", 7),
	]);
	assert.equal(s.count, 2);
	assert.equal(s.malformed, 7);
	assert.deepEqual(s.byHourUtc, { "2026-10-12T10": 2 });
	assert.equal(s.p95Ms, 7);
});

test("only malformed lines: no crash, p95 null", () => {
	assert.deepEqual(summarize(["nope", "still nope"]), { count: 0, malformed: 2, p95Ms: null, byHourUtc: {} });
});
