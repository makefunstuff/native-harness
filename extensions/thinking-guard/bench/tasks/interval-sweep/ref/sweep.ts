// Peak load of weighted half-open reservations [start, end).
export type Reservation = [start: number, end: number, weight: number];
export type Span = [from: number, to: number];

export function computeMaxLoad(intervals: Reservation[]): [number, Span[]] {
	const delta = new Map<number, number>();
	for (const [start, end, weight] of intervals) {
		if (end < start) throw new Error(`invalid reservation [${start}, ${end})`);
		if (end === start) continue;
		delta.set(start, (delta.get(start) ?? 0) + weight);
		delta.set(end, (delta.get(end) ?? 0) - weight);
	}
	const xs = [...delta.keys()].sort((a, b) => a - b);
	const segments: Array<[number, number, number]> = [];
	let load = 0;
	for (let i = 0; i + 1 < xs.length; i++) {
		load += delta.get(xs[i])!;
		segments.push([xs[i], xs[i + 1], load]);
	}
	const maxLoad = Math.max(0, ...segments.map((s) => s[2]));
	if (maxLoad === 0) return [0, []];
	const spans: Span[] = [];
	for (const [from, to, l] of segments) {
		if (l !== maxLoad) continue;
		const last = spans.at(-1);
		if (last && last[1] === from) last[1] = to;
		else spans.push([from, to]);
	}
	return [maxLoad, spans];
}
