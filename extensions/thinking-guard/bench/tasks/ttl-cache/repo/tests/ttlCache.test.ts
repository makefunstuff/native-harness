import assert from "node:assert/strict";
import { test } from "node:test";
import { TTLCache } from "../ttlCache.ts";

test("caches a value", async () => {
	const c = new TTLCache<number>(60);
	let calls = 0;
	assert.equal(await c.getOrCompute("a", async () => ++calls), 1);
	assert.equal(await c.getOrCompute("a", async () => ++calls), 1);
	assert.equal(c.size, 1);
});
