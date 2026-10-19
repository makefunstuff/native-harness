import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLine } from "../parser.ts";

test("fields", () => {
	const r = parseLine("2026-10-01T12:00:00Z GET /a 200 15ms");
	assert.equal(r.method, "GET");
	assert.equal(r.status, 200);
	assert.equal(r.latencyMs, 15);
});

test("offset converted to UTC", () => {
	const r = parseLine("2026-10-01T12:00:00+03:00 GET /a 200 15ms");
	assert.equal(r.time.getUTCHours(), 9);
});
