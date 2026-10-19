import assert from "node:assert/strict";
import test from "node:test";
import { computeMaxLoad } from "./src/sweep.ts";

type Iv = [number, number, number];

// Brute force over unit cells [x, x+1): independent of any sweep.
function oracle(intervals: Iv[]) {
	const cells = new Map<number, number>();
	for (const [s, e, w] of intervals) for (let x = s; x < e; x++) cells.set(x, (cells.get(x) ?? 0) + w);
	let maxLoad = 0;
	for (const v of cells.values()) maxLoad = Math.max(maxLoad, v);
	if (maxLoad === 0) return { maxLoad: 0, spans: [] as Array<[number, number]> };
	const xs = [...cells.keys()].filter((x) => cells.get(x) === maxLoad).sort((a, b) => a - b);
	const spans: Array<[number, number]> = [];
	for (const x of xs) {
		const last = spans[spans.length - 1];
		if (last && last[1] === x) last[1] = x + 1;
		else spans.push([x, x + 1]);
	}
	return { maxLoad, spans };
}

test("touching intervals do not overlap", () => {
	assert.deepEqual(computeMaxLoad([[0, 5, 1], [5, 10, 1]]), { maxLoad: 1, spans: [[0, 10]] });
	assert.deepEqual(computeMaxLoad([[0, 5, 2], [5, 10, 1]]), { maxLoad: 2, spans: [[0, 5]] });
});

test("zero-length intervals are ignored", () => {
	assert.deepEqual(computeMaxLoad([[3, 3, 100], [0, 10, 1]]), { maxLoad: 1, spans: [[0, 10]] });
	assert.deepEqual(computeMaxLoad([[3, 3, 5]]), { maxLoad: 0, spans: [] });
	assert.deepEqual(computeMaxLoad([]), { maxLoad: 0, spans: [] });
});

test("adjacent max spans merge; separate ones stay apart", () => {
	assert.deepEqual(computeMaxLoad([[0, 4, 1], [0, 2, 1], [2, 4, 1]]), { maxLoad: 2, spans: [[0, 4]] });
	assert.deepEqual(computeMaxLoad([[0, 2, 2], [3, 5, 2]]), { maxLoad: 2, spans: [[0, 2], [3, 5]] });
});

test("negative coordinates, invalid intervals", () => {
	assert.deepEqual(computeMaxLoad([[-10, -2, 3], [-5, 0, 1]]), { maxLoad: 4, spans: [[-5, -2]] });
	assert.throws(() => computeMaxLoad([[5, 4, 1]]), RangeError);
});

test("matches a brute-force oracle on random inputs", () => {
	let seed = 12345;
	const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
	for (let round = 0; round < 300; round++) {
		const ivs: Iv[] = [];
		for (let k = 0, n = 1 + rand(8); k < n; k++) {
			const s = rand(30) - 10;
			ivs.push([s, s + rand(8), 1 + rand(3)]);
		}
		assert.deepEqual(computeMaxLoad(ivs), oracle(ivs), JSON.stringify(ivs));
	}
});
