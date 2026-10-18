import assert from "node:assert/strict";
import { test } from "node:test";
import { EventError } from "./protocol.ts";
import { reduceEvents } from "./reconcile.ts";

test("empty input", () => {
	assert.deepEqual(reduceEvents([]), {});
	const st = { a: 1 };
	const r = reduceEvents([], st);
	assert.deepEqual(r, { a: 1 });
	assert.notEqual(r, st);
});

test("greatest revision wins, ties go to the last occurrence", () => {
	assert.deepEqual(reduceEvents([
		{ key: "k", revision: 1, operation: "put", value: "old" },
		{ key: "k", revision: 3, operation: "put", value: "new" },
		{ key: "k", revision: 2, operation: "put", value: "mid" },
	]), { k: "new" });
	assert.deepEqual(reduceEvents([
		{ key: "k", revision: 5, operation: "put", value: "first" },
		{ key: "k", revision: 5, operation: "put", value: "second" },
	]), { k: "second" });
});

test("deletes", () => {
	assert.deepEqual(reduceEvents([
		{ key: "k", revision: 1, operation: "put", value: "x" },
		{ key: "k", revision: 2, operation: "delete" },
		{ key: "k", revision: 3, operation: "put", value: "z" },
	]), { k: "z" });
	assert.deepEqual(reduceEvents([
		{ key: "k", revision: 2, operation: "delete" },
		{ key: "k", revision: 1, operation: "put", value: "x" },
	]), {});
	assert.deepEqual(reduceEvents([{ key: "a", revision: 1, operation: "delete" }], { a: 1, b: 2 }), { b: 2 });
});

test("no aliasing, inputs untouched", () => {
	const st = { k: { m: [1, 2] } };
	(reduceEvents([], st).k as any).m.push(99);
	assert.deepEqual(st.k.m, [1, 2]);
	const v = { nested: { x: 1 } };
	(reduceEvents([{ key: "k", revision: 0, operation: "put", value: v }]).k as any).nested.x = 9;
	assert.equal(v.nested.x, 1);
	const evs = [{ key: "k", revision: 1, operation: "put", value: "a" }, { key: "j", revision: 0, operation: "put", value: "b" }];
	const snap = structuredClone(evs);
	reduceEvents(evs);
	assert.deepEqual(evs, snap);
});

test("invalid events throw EventError", () => {
	for (const bad of [
		{ revision: 0, operation: "put", value: 1 },
		{ key: "k", operation: "put", value: 1 },
		{ key: "k", revision: -1, operation: "put", value: 1 },
		{ key: "k", revision: 1.5, operation: "put", value: 1 },
		{ key: "k", revision: 0, operation: "upsert", value: 1 },
		{ key: "k", revision: 0, operation: "put" },
		{ key: "k", revision: true, operation: "put", value: 1 },
	])
		assert.throws(() => reduceEvents([bad]), EventError, JSON.stringify(bad));
});

test("an invalid event mid-list changes nothing", () => {
	const st = { keep: 1 };
	assert.throws(() => reduceEvents([
		{ key: "k", revision: 1, operation: "put", value: "a" },
		{ key: "z", revision: -3, operation: "put", value: "bad" },
	], st), EventError);
	assert.deepEqual(st, { keep: 1 });
});
