import assert from "node:assert/strict";
import { test } from "node:test";
import { TTLCache } from "../ttlcache.ts";

test("caches a value", async () => {
	const c = new TTLCache<number>(1000);
	let calls = 0;
	const fn = async () => ++calls;
	assert.equal(await c.getOrCompute("a", fn), 1);
	assert.equal(await c.getOrCompute("a", fn), 1);
	assert.equal(calls, 1);
});
