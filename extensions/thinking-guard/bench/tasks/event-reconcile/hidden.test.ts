import assert from "node:assert/strict";
import { test } from "node:test";
import { EventError, validateEvent } from "./protocol.ts";
import { reduceEvents } from "./reconcile.ts";

const put = (key: string, revision: number, value: unknown) => ({ key, revision, operation: "put", value });
const del = (key: string, revision: number) => ({ key, revision, operation: "delete" });

test("validation", () => {
	for (const bad of [{}, { key: "a", operation: "put", value: 1 }, put("a", -1, 1), put("a", 1.5, 1),
		{ key: "a", revision: 1, operation: "upsert", value: 1 }, { key: "a", revision: 1, operation: "put" }, { revision: 1, operation: "delete" }])
		assert.throws(() => validateEvent(bad), EventError, JSON.stringify(bad));
	const ok = put("a", 0, null);
	assert.equal(validateEvent(ok), ok);
	assert.ok(new EventError("x") instanceof Error);
});

test("greatest revision wins, ties go to the later event", () => {
	assert.deepEqual(reduceEvents([put("a", 2, "new"), put("a", 1, "old")]), { a: "new" });
	assert.deepEqual(reduceEvents([put("a", 1, "first"), put("a", 1, "second")]), { a: "second" });
	assert.deepEqual(reduceEvents([put("a", 3, "x"), del("a", 3)]), {});
	assert.deepEqual(reduceEvents([del("a", 3), put("a", 3, "x")]), { a: "x" });
});

test("delete and existing state", () => {
	assert.deepEqual(reduceEvents([del("a", 1), put("b", 1, 2)], { a: 1, c: 3 }), { b: 2, c: 3 });
});

test("no mutation and no aliasing", () => {
	const value = { deep: [1, 2] };
	const events = [put("a", 1, value)];
	const state = { s: { n: 1 } };
	const snapshot = structuredClone({ events, state });
	const out: any = reduceEvents(events, state);
	assert.deepEqual({ events, state }, snapshot);
	out.a.deep.push(3);
	out.s.n = 99;
	assert.deepEqual({ events, state }, snapshot);
});

test("empty input returns a fresh copy", () => {
	const state = { a: { b: 1 } };
	const out: any = reduceEvents([], state);
	assert.deepEqual(out, state);
	assert.notEqual(out, state);
	assert.notEqual(out.a, state.a);
	assert.deepEqual(reduceEvents([]), {});
});

test("an invalid event changes nothing", () => {
	const state = { a: 1 };
	assert.throws(() => reduceEvents([put("b", 1, 2), { key: "c", revision: -1, operation: "put", value: 1 }], state), EventError);
	assert.deepEqual(state, { a: 1 });
});
