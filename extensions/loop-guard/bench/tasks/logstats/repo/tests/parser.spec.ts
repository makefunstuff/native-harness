import assert from "node:assert/strict";
import { test } from "node:test";
import { p95Latency, parseLine } from "../logstats/parser.ts";

test("fields", () => {
	const e = parseLine("2026-10-01T12:00:00Z GET /x 200 15ms");
	assert.equal(e.method, "GET");
	assert.equal(e.status, 200);
	assert.equal(e.ms, 15);
});

test("p95 of one", () => {
	assert.equal(p95Latency(["2026-10-01T12:00:00Z GET /x 200 7ms"]), 7);
});
