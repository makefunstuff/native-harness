// Peak load of weighted half-open intervals [start, end).
export type Interval = [number, number, number];

export function computeMaxLoad(intervals: Interval[]): { maxLoad: number; spans: Array<[number, number]> } {
	const events: Array<[number, number]> = [];
	for (const [s, e, w] of intervals) {
		if (e < s) throw new RangeError(`interval ends before it starts: [${s}, ${e})`);
		events.push([s, w], [e, -w]);
	}
	// starts before ends at the same coordinate
	events.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
	let load = 0;
	let maxLoad = 0;
	let spans: Array<[number, number]> = [];
	for (let i = 0; i < events.length; i++) {
		load += events[i][1];
		const next = events[i + 1]?.[0];
		if (next === undefined) break;
		if (load > maxLoad) {
			maxLoad = load;
			spans = [];
		}
		if (load === maxLoad && next > events[i][0]) spans.push([events[i][0], next]);
	}
	return { maxLoad, spans };
}
