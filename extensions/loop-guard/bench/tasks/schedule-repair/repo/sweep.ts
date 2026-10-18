// Peak load of weighted half-open intervals.
export type Interval = [number, number, number];

export function computeMaxLoad(intervals: Interval[]): [number, Array<[number, number]>] {
	const cleaned: Interval[] = [];
	for (const [start, end, weight] of intervals) {
		if (end < start) throw new RangeError("end < start");
		if (start === end) continue;
		cleaned.push([start, end, weight]);
	}
	if (!cleaned.length) return [0, []];
	const points = [...new Set(cleaned.flatMap(([s, e]) => [s, e]))].sort((a, b) => a - b);
	const pieces: Array<[number, number, number]> = [];
	for (let i = 0; i + 1 < points.length; i++) {
		const a = points[i], b = points[i + 1];
		const mid = (a + b) / 2;
		let load = 0;
		for (const [s, e, w] of cleaned) if (s <= mid && mid <= e) load += w;
		for (const [s, e, w] of cleaned) if (s === a || e === a) load += w;
		pieces.push([a, b, load]);
	}
	const maxLoad = Math.max(0, ...pieces.map((p) => p[2]));
	const spans = pieces.filter((p) => p[2] === maxLoad).map(([a, b]) => [a, b] as [number, number]);
	return [maxLoad, spans];
}
