import assert from "node:assert/strict";
import { test } from "node:test";
import { computeMaxLoad, type Reservation } from "./sweep.ts";

// Brute force over unit cells [x, x+1): independent of any sweep.
function oracle(intervals: Reservation[]): [number, Array<[number, number]>] {
	for (const [s, e] of intervals) if (e < s) throw new Error("invalid");
	const live = intervals.filter(([s, e]) => e > s);
	if (!live.length) return [0, []];
	const lo = Math.min(...live.map((r) => r[0]));
	const hi = Math.max(...live.map((r) => r[1]));
	const load = (x: number) => live.reduce((sum, [s, e, w]) => sum + (s <= x && x < e ? w : 0), 0);
	let max = 0;
	for (let x = lo; x < hi; x++) max = Math.max(max, load(x));
	const spans: Array<[number, number]> = [];
	for (let x = lo; x < hi; x++) {
		if (load(x) !== max) continue;
		const last = spans.at(-1);
		if (last && last[1] === x) last[1] = x + 1;
		else spans.push([x, x + 1]);
	}
	return [max, spans];
}

function rng(seed: number) {
	return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

test("touching reservations do not stack", () => {
	assert.deepEqual(computeMaxLoad([[0, 5, 2], [5, 9, 2]]), [2, [[0, 9]]]);
});

test("zero-length reservations are ignored", () => {
	assert.deepEqual(computeMaxLoad([[3, 3, 50], [0, 2, 1]]), [1, [[0, 2]]]);
	assert.deepEqual(computeMaxLoad([[3, 3, 5]]), [0, []]);
});

test("adjacent equal-load spans merge", () => {
	assert.deepEqual(computeMaxLoad([[0, 4, 3], [4, 6, 1], [4, 6, 2]]), [3, [[0, 6]]]);
});

test("invalid reservation throws", () => {
	assert.throws(() => computeMaxLoad([[5, 1, 1]]), Error);
});

test("negative coordinates", () => {
	assert.deepEqual(computeMaxLoad([[-5, -1, 2], [-3, 2, 1]]), [3, [[-3, -1]]]);
});

test("random reservations match the brute force", () => {
	const r = rng(42);
	for (let n = 0; n < 60; n++) {
		const items: Reservation[] = [];
		const k = 1 + Math.floor(r() * 7);
		for (let i = 0; i < k; i++) {
			const s = Math.floor(r() * 20) - 10;
			const e = s + Math.floor(r() * 6);
			items.push([s, e, 1 + Math.floor(r() * 3)]);
		}
		assert.deepEqual(computeMaxLoad(items), oracle(items), JSON.stringify(items));
	}
});
