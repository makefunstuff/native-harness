import assert from "node:assert/strict";
import { test } from "node:test";
import { p95Latency, parseLine } from "./parser.ts";

const line = (ms: number, ts = "2026-10-01T12:00:00Z") => `${ts} GET /x 200 ${ms}ms`;

test("Z is UTC", () => {
	assert.equal(parseLine(line(1)).time.toISOString(), "2026-10-01T12:00:00.000Z");
});

test("positive offset", () => {
	assert.equal(parseLine(line(1, "2026-10-01T01:30:00+03:00")).time.toISOString(), "2026-09-30T22:30:00.000Z");
});

test("negative offset", () => {
	assert.equal(parseLine(line(1, "2026-10-01T20:00:00-05:00")).time.toISOString(), "2026-10-02T01:00:00.000Z");
});

test("p95 nearest rank", () => {
	for (const n of [1, 2, 19, 20, 21, 100, 101]) {
		const vals = Array.from({ length: n }, (_, i) => i + 1).reverse();
		assert.equal(p95Latency(vals.map((v) => line(v))), Math.ceil(0.95 * n), String(n));
	}
});

test("p95 of nothing throws RangeError", () => {
	assert.throws(() => p95Latency([]), RangeError);
});

test("malformed lines throw SyntaxError", () => {
	for (const bad of ["", "garbage", "2026-10-01T12:00:00Z GET /x", "2026-10-01T12:00:00Z GET /x abc 5ms",
		"notatime GET /x 200 5ms", "2026-10-01T12:00:00Z GET /x 200 fast"])
		assert.throws(() => parseLine(bad), SyntaxError, bad);
});
