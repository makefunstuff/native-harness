import assert from "node:assert/strict";
import test from "node:test";
import { TtlCache } from "../src/ttlcache.ts";

test("caches a computed value", async () => {
	const cache = new TtlCache<number>(60_000);
	let calls = 0;
	const load = async () => ++calls;
	assert.equal(await cache.getOrCompute("a", load), 1);
	assert.equal(await cache.getOrCompute("a", load), 1);
	assert.equal(calls, 1);
});
