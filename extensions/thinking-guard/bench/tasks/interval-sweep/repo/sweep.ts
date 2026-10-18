// Peak load of weighted half-open reservations [start, end).
export type Reservation = [start: number, end: number, weight: number];
export type Span = [from: number, to: number];

export function computeMaxLoad(intervals: Reservation[]): [number, Span[]] {
	const events: Array<[number, number]> = [];
	for (const [start, end, weight] of intervals) {
		events.push([start, weight]);
		events.push([end, -weight]);
	}
	// starts before ends at the same coordinate
	events.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
	let load = 0;
	let maxLoad = 0;
	let spans: Span[] = [];
	for (let i = 0; i < events.length; i++) {
		const [x, delta] = events[i];
		load += delta;
		const next = i + 1 < events.length ? events[i + 1][0] : x;
		if (load > maxLoad) {
			maxLoad = load;
			spans = [[x, next]];
		} else if (load === maxLoad && maxLoad > 0) {
			spans.push([x, next]);
		}
	}
	return [maxLoad, spans];
}
