import assert from "node:assert/strict";
import { test } from "node:test";
import { TTLCache } from "./ttlcache.ts";

function deferred<T>() {
	let resolve!: (v: T) => void, reject!: (e: unknown) => void;
	const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
	return { promise, resolve, reject };
}

test("one loader per key at a time", async () => {
	const c = new TTLCache<number>(1000);
	const d = deferred<number>();
	let calls = 0;
	const fn = () => (calls++, d.promise);
	const all = Array.from({ length: 10 }, () => c.getOrCompute("k", fn));
	await new Promise((r) => setTimeout(r, 5));
	d.resolve(42);
	assert.deepEqual(await Promise.all(all), Array(10).fill(42));
	assert.equal(calls, 1);
});

test("different keys run concurrently", async () => {
	const c = new TTLCache<string>(1000);
	const a = deferred<string>(), b = deferred<string>();
	const started: string[] = [];
	const pa = c.getOrCompute("a", () => (started.push("a"), a.promise));
	const pb = c.getOrCompute("b", () => (started.push("b"), b.promise));
	await new Promise((r) => setTimeout(r, 5));
	assert.deepEqual(started.sort(), ["a", "b"]);
	b.resolve("B");
	assert.equal(await pb, "B");
	a.resolve("A");
	assert.equal(await pa, "A");
});

test("a rejection reaches every waiter and is not cached", async () => {
	const c = new TTLCache<number>(1000);
	const d = deferred<number>();
	let calls = 0;
	const fn = () => (calls++, d.promise);
	const all = Array.from({ length: 3 }, () => c.getOrCompute("k", fn));
	const boom = new Error("boom");
	d.reject(boom);
	for (const p of all) await assert.rejects(p, (e) => e === boom);
	assert.equal(await c.getOrCompute("k", async () => (calls++, 7)), 7);
	assert.equal(calls, 2);
});

test("ttl and size with a fake clock", async () => {
	let now = 0;
	const c = new TTLCache<number>(100, () => now);
	let calls = 0;
	const fn = async () => ++calls;
	await c.getOrCompute("a", fn);
	now = 50;
	await c.getOrCompute("b", fn);
	assert.equal(c.size, 2);
	now = 99;
	assert.equal(await c.getOrCompute("a", fn), 1);
	now = 100;
	assert.equal(c.size, 1);
	assert.equal(await c.getOrCompute("a", fn), 3);
	now = 1000;
	assert.equal(c.size, 0);
});
