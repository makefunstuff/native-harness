import assert from "node:assert/strict";
import { test } from "node:test";
import { computeMaxLoad, type Interval } from "./sweep.ts";

// independent brute force over the same half-open semantics
function oracle(intervals: Interval[]): [number, Array<[number, number]>] {
	const c = intervals.filter(([s, e]) => s < e);
	if (!c.length) return [0, []];
	const pts = [...new Set(c.flatMap(([s, e]) => [s, e]))].sort((a, b) => a - b);
	const pieces = pts.slice(0, -1).map((a, i) => [a, pts[i + 1], c.filter(([s, e]) => s <= a && pts[i + 1] <= e).reduce((x, [, , w]) => x + w, 0)]);
	const max = Math.max(...pieces.map((p) => p[2]));
	const runs: Array<[number, number]> = [];
	let cur: [number, number] | undefined;
	for (const [a, b, l] of pieces) {
		if (l === max) cur ? (cur[1] = b) : (cur = [a, b]);
		else if (cur) runs.push(cur), (cur = undefined);
	}
	if (cur) runs.push(cur);
	return [max, runs];
}

const CASES: Record<string, Interval[]> = {
	empty: [],
	only_zero_length: [[2, 2, 5], [-1, -1, 3]],
	single: [[0, 5, 2]],
	join_merge: [[0, 5, 1], [5, 10, 1]],
	simultaneous_boundary: [[0, 4, 3], [4, 9, 3]],
	overlap_peak: [[0, 10, 2], [3, 7, 3], [4, 5, 1]],
	nested: [[0, 10, 1], [1, 9, 2], [2, 8, 3]],
	negative: [[-10, -2, 4], [-7, -1, 5]],
	duplicates: [[0, 4, 2], [0, 4, 2], [1, 3, 1]],
	zero_and_join: [[0, 0, 9], [1, 3, 2], [3, 6, 2]],
};

test("fixed cases", () => {
	for (const [name, ivs] of Object.entries(CASES)) assert.deepEqual(computeMaxLoad(ivs), oracle(ivs), name);
});

test("order does not matter", () => {
	const ivs: Interval[] = [[0, 10, 2], [3, 7, 3], [4, 5, 1], [-2, 8, 2], [6, 12, 2]];
	assert.deepEqual(computeMaxLoad([...ivs].reverse()), oracle(ivs));
});

test("end < start throws", () => {
	assert.throws(() => computeMaxLoad([[5, 2, 1]]), RangeError);
});

test("random parity with the oracle", () => {
	let seed = 20260908;
	const rnd = (lo: number, hi: number) => lo + ((seed = (seed * 1103515245 + 12345) % 2147483648) % (hi - lo + 1));
	for (let t = 0; t < 50; t++) {
		const ivs: Interval[] = [];
		for (let k = rnd(0, 12); k > 0; k--) {
			const s = rnd(-20, 20);
			ivs.push([s, rnd(s, 20), rnd(1, 5)]);
		}
		assert.deepEqual(computeMaxLoad(ivs), oracle(ivs), JSON.stringify(ivs));
	}
});
