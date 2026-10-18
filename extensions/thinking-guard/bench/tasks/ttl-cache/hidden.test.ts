import assert from "node:assert/strict";
import { test } from "node:test";
import { TTLCache } from "./ttlCache.ts";

const tick = () => new Promise((ok) => setTimeout(ok, 5));

test("one loader per key at a time; all callers get its result", async () => {
	const c = new TTLCache<number>(60);
	let calls = 0;
	const fn = async () => {
		calls++;
		await tick();
		return 42;
	};
	const results = await Promise.all(Array.from({ length: 20 }, () => c.getOrCompute("k", fn)));
	assert.equal(calls, 1);
	assert.deepEqual(new Set(results), new Set([42]));
});

test("different keys run in parallel", async () => {
	const c = new TTLCache<string>(60);
	let releaseA!: () => void;
	const aGate = new Promise<void>((ok) => (releaseA = ok));
	let bStarted = false;
	const a = c.getOrCompute("a", async () => {
		await aGate;
		return "a";
	});
	const b = c.getOrCompute("b", async () => {
		bStarted = true;
		return "b";
	});
	assert.equal(await Promise.race([b, tick().then(() => "timeout")]), "b");
	assert.ok(bStarted);
	releaseA();
	assert.equal(await a, "a");
});

test("a rejection reaches every waiter and is not cached", async () => {
	const c = new TTLCache<number>(60);
	let calls = 0;
	const failing = async () => {
		calls++;
		await tick();
		throw new Error("db down");
	};
	const all = await Promise.allSettled([c.getOrCompute("k", failing), c.getOrCompute("k", failing), c.getOrCompute("k", failing)]);
	assert.equal(calls, 1);
	assert.ok(all.every((r) => r.status === "rejected" && (r.reason as Error).message === "db down"));
	assert.equal(await c.getOrCompute("k", async () => 7), 7);
});

test("entries expire after ttl on the given clock; size counts live entries", async () => {
	let now = 1000;
	const c = new TTLCache<number>(10, () => now);
	let calls = 0;
	await c.getOrCompute("k", async () => ++calls);
	now += 9;
	assert.equal(await c.getOrCompute("k", async () => ++calls), 1);
	assert.equal(c.size, 1);
	now += 2;
	assert.equal(c.size, 0);
	assert.equal(await c.getOrCompute("k", async () => ++calls), 2);
});
