import assert from "node:assert/strict";
import test from "node:test";
import { summarize } from "../src/logstats.ts";

test("counts UTC lines per hour", () => {
	const s = summarize(["2026-10-12T10:05:00Z GET / 200 5ms", "2026-10-12T10:59:59Z GET /a 404 7ms"]);
	assert.equal(s.count, 2);
	assert.deepEqual(s.byHourUtc, { "2026-10-12T10": 2 });
});
