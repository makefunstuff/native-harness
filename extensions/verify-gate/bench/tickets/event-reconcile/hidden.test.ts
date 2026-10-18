import assert from "node:assert/strict";
import test from "node:test";
import { EventError, validateEvent } from "./src/protocol.ts";
import { reduceEvents } from "./src/reconcile.ts";

const put = (key: string, revision: number, value: unknown) => ({ key, revision, operation: "put", value });
const del = (key: string, revision: number) => ({ key, revision, operation: "delete" });

test("greatest revision wins regardless of order", () => {
	assert.deepEqual(reduceEvents([put("a", 5, 1), put("a", 2, 2), put("a", 4, 3)]), { a: 1 });
});

test("equal revisions: the later occurrence wins", () => {
	assert.deepEqual(reduceEvents([put("a", 1, "first"), put("a", 1, "second")]), { a: "second" });
	assert.deepEqual(reduceEvents([put("a", 1, "x"), del("a", 1)]), {});
	assert.deepEqual(reduceEvents([del("a", 1), put("a", 1, "y")], { a: "old" }), { a: "y" });
});

test("delete removes, newer put after delete restores, unknown keys are fine", () => {
	assert.deepEqual(reduceEvents([del("a", 3)], { a: 1, b: 2 }), { b: 2 });
	assert.deepEqual(reduceEvents([del("a", 1), put("a", 2, 9)], { a: 1 }), { a: 9 });
	assert.deepEqual(reduceEvents([del("zzz", 1)], { a: 1 }), { a: 1 });
});

test("a newer delete beats an older put that comes later", () => {
	assert.deepEqual(reduceEvents([del("a", 7), put("a", 3, "late")]), {});
});

test("events win over existing state keys they touch; others kept", () => {
	assert.deepEqual(reduceEvents([put("a", 0, "new")], { a: "old", b: "keep" }), { a: "new", b: "keep" });
});

test("no mutation, no aliasing", () => {
	const value = { nested: [1, 2] };
	const events = [put("a", 1, value)];
	const snapshot = JSON.stringify(events);
	const state = { s: { deep: { x: 1 } } };
	const out = reduceEvents(events, state) as any;
	assert.equal(JSON.stringify(events), snapshot);
	assert.deepEqual(state, { s: { deep: { x: 1 } } });
	assert.notEqual(out.a, value);
	assert.notEqual(out.a.nested, value.nested);
	assert.notEqual(out.s, state.s);
	assert.notEqual(out.s.deep, state.s.deep);
	out.a.nested.push(3);
	out.s.deep.x = 2;
	assert.deepEqual(value.nested, [1, 2]);
	assert.equal(state.s.deep.x, 1);
});

test("empty input: equal fresh copy", () => {
	const state = { a: { b: 1 } };
	const out = reduceEvents([], state);
	assert.deepEqual(out, state);
	assert.notEqual(out, state);
	assert.notEqual((out as any).a, state.a);
	assert.deepEqual(reduceEvents([]), {});
});

test("validation", () => {
	const bad: unknown[] = [
		null, 5, "x", [],
		{ revision: 1, operation: "put", value: 1 },
		{ key: 1, revision: 1, operation: "put", value: 1 },
		{ key: "k", operation: "put", value: 1 },
		{ key: "k", revision: -1, operation: "put", value: 1 },
		{ key: "k", revision: 1.5, operation: "put", value: 1 },
		{ key: "k", revision: "1", operation: "put", value: 1 },
		{ key: "k", revision: 0, operation: "upsert", value: 1 },
		{ key: "k", revision: 0, operation: "put" },
	];
	for (const e of bad) assert.throws(() => validateEvent(e), EventError, JSON.stringify(e));
	assert.doesNotThrow(() => validateEvent({ key: "k", revision: 0, operation: "put", value: null }));
	assert.doesNotThrow(() => validateEvent({ key: "k", revision: 0, operation: "delete" }));
	const ev = { key: "k", revision: 0, operation: "put", value: 1 };
	assert.equal(validateEvent(ev), ev);
});

test("an invalid event anywhere: EventError, state untouched", () => {
	const state = { a: 1 };
	assert.throws(() => reduceEvents([put("a", 1, 2), { key: "b", revision: -1, operation: "put", value: 1 }], state), EventError);
	assert.deepEqual(state, { a: 1 });
});

test("EventError is an Error", () => {
	assert.ok(new EventError("x") instanceof Error);
});
