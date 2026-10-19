// Peak load of weighted half-open intervals [start, end).
export type Interval = [number, number, number];

export function computeMaxLoad(intervals: Interval[]): { maxLoad: number; spans: Array<[number, number]> } {
	const events: Array<[number, number]> = [];
	for (const [s, e, w] of intervals) {
		if (e < s) throw new RangeError(`interval ends before it starts: [${s}, ${e})`);
		if (s === e) continue;
		events.push([s, w], [e, -w]);
	}
	// ends before starts at the same coordinate: [a, b) and [b, c) never overlap
	events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	let load = 0;
	let maxLoad = 0;
	let spans: Array<[number, number]> = [];
	let i = 0;
	while (i < events.length) {
		const x = events[i][0];
		while (i < events.length && events[i][0] === x) load += events[i++][1];
		const next = events[i]?.[0];
		if (next === undefined) break;
		if (load > maxLoad) {
			maxLoad = load;
			spans = [];
		}
		if (load === maxLoad && load > 0) {
			const last = spans[spans.length - 1];
			if (last && last[1] === x) last[1] = next;
			else spans.push([x, next]);
		}
	}
	return { maxLoad, spans };
}
