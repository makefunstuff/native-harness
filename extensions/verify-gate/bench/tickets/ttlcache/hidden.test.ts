import assert from "node:assert/strict";
import test from "node:test";
import { TtlCache } from "./src/ttlcache.ts";

function deferred<T>() {
	let resolve!: (v: T) => void, reject!: (e: unknown) => void;
	const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
	return { promise, resolve, reject };
}

test("one loader per key; all concurrent callers get its result", async () => {
	const cache = new TtlCache<string>(1000, { now: () => 0 });
	const d = deferred<string>();
	let calls = 0;
	const load = () => (calls++, d.promise);
	const all = Promise.all(Array.from({ length: 20 }, () => cache.getOrCompute("k", load)));
	await new Promise((r) => setTimeout(r, 10));
	d.resolve("v");
	assert.deepEqual(await all, Array(20).fill("v"));
	assert.equal(calls, 1);
});

test("different keys do not wait for each other", async () => {
	const cache = new TtlCache<string>(1000, { now: () => 0 });
	const slow = deferred<string>();
	const a = cache.getOrCompute("a", () => slow.promise);
	const b = await Promise.race([cache.getOrCompute("b", async () => "b"), new Promise((r) => setTimeout(() => r("blocked"), 200))]);
	assert.equal(b, "b");
	slow.resolve("a");
	assert.equal(await a, "a");
});

test("a rejection reaches every waiter and is not cached", async () => {
	const cache = new TtlCache<string>(1000, { now: () => 0 });
	const d = deferred<string>();
	let calls = 0;
	const ps = Array.from({ length: 5 }, () => cache.getOrCompute("k", () => (calls++, d.promise)));
	const err = new Error("db down");
	d.reject(err);
	const results = await Promise.allSettled(ps);
	assert.ok(results.every((r) => r.status === "rejected" && r.reason === err));
	assert.equal(calls, 1);
	assert.equal(await cache.getOrCompute("k", async () => "ok"), "ok");
	assert.equal(cache.size, 1);
});

test("ttl: fresh while now - storedAt < ttl", async () => {
	let t = 1000;
	const cache = new TtlCache<number>(100, { now: () => t });
	let calls = 0;
	const load = async () => ++calls;
	assert.equal(await cache.getOrCompute("k", load), 1);
	t = 1099;
	assert.equal(await cache.getOrCompute("k", load), 1);
	assert.equal(cache.size, 1);
	t = 1100;
	assert.equal(cache.size, 0);
	assert.equal(await cache.getOrCompute("k", load), 2);
});

test("size counts only fresh entries", async () => {
	let t = 0;
	const cache = new TtlCache<number>(100, { now: () => t });
	await cache.getOrCompute("a", async () => 1);
	t = 50;
	await cache.getOrCompute("b", async () => 2);
	assert.equal(cache.size, 2);
	t = 120;
	assert.equal(cache.size, 1);
	t = 200;
	assert.equal(cache.size, 0);
});

test("the default clock is monotonic (not Date.now)", async () => {
	const realNow = Date.now;
	const cache = new TtlCache<number>(10_000);
	try {
		let calls = 0;
		await cache.getOrCompute("k", async () => ++calls);
		Date.now = () => realNow() + 1e9; // wall clock jumps forward
		assert.equal(await cache.getOrCompute("k", async () => ++calls), 1);
	} finally {
		Date.now = realNow;
	}
});

test("recomputation after expiry is single-flight too", async () => {
	let t = 0;
	const cache = new TtlCache<number>(10, { now: () => t });
	let calls = 0;
	await cache.getOrCompute("k", async () => ++calls);
	t = 100;
	const d = deferred<number>();
	const ps = Array.from({ length: 5 }, () => cache.getOrCompute("k", () => (calls++, d.promise)));
	d.resolve(42);
	assert.deepEqual(await Promise.all(ps), [42, 42, 42, 42, 42]);
	assert.equal(calls, 2);
});
