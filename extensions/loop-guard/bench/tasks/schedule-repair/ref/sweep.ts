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
		let load = 0;
		for (const [s, e, w] of cleaned) if (s <= a && b <= e) load += w;
		pieces.push([a, b, load]);
	}
	const maxLoad = Math.max(0, ...pieces.map((p) => p[2]));
	const spans: Array<[number, number]> = [];
	for (const [a, b, load] of pieces) {
		if (load !== maxLoad) continue;
		const last = spans[spans.length - 1];
		if (last && last[1] === a) last[1] = b;
		else spans.push([a, b]);
	}
	return [maxLoad, spans];
}
