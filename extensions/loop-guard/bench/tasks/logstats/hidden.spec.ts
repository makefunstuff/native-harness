import assert from "node:assert/strict";
import { test } from "node:test";
import { p95Latency, parseLine } from "./logstats/parser.ts";

const line = (ms: number, ts = "2026-10-01T12:00:00Z") => `${ts} GET /x 200 ${ms}ms`;

test("Z is UTC", () => {
	assert.equal(parseLine(line(1)).time.getTime(), Date.UTC(2026, 9, 1, 12));
});

test("offsets", () => {
	assert.equal(parseLine(line(1, "2026-10-01T01:30:00+03:00")).time.getTime(), Date.UTC(2026, 8, 30, 22, 30));
	assert.equal(parseLine(line(1, "2026-10-01T20:00:00-05:00")).time.getTime(), Date.UTC(2026, 9, 2, 1));
});

test("p95 nearest rank", () => {
	let seed = 7;
	const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
	for (const n of [1, 2, 9, 19, 20, 21, 100, 101]) {
		const vals = Array.from({ length: n }, (_, i) => i + 1);
		for (let i = n - 1; i > 0; i--) {
			const j = Math.floor(rnd() * (i + 1));
			[vals[i], vals[j]] = [vals[j], vals[i]];
		}
		const expect = [...vals].sort((a, b) => a - b)[Math.ceil(0.95 * n) - 1];
		assert.equal(p95Latency(vals.map((v) => line(v))), expect, `n=${n}`);
	}
});

test("p95 empty", () => {
	assert.throws(() => p95Latency([]), RangeError);
});

test("malformed", () => {
	for (const bad of ["", "garbage", "2026-10-01T12:00:00Z GET /x", "2026-10-01T12:00:00Z GET /x abc 5ms",
		"notatime GET /x 200 5ms", "2026-10-01T12:00:00Z GET /x 200 fast", "2026-13-45T99:00:00Z GET /x 200 5ms"])
		assert.throws(() => parseLine(bad), RangeError, JSON.stringify(bad));
});
