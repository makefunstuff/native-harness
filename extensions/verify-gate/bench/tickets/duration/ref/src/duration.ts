// Durations like "90s", "5m", "1h30m" or "250ms", in milliseconds.
const UNIT: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
const ORDER = ["h", "m", "s", "ms"];

export function parseDuration(text: string): number {
	if (!/^(\d+(ms|h|m|s))+$/.test(text)) throw new RangeError(`bad duration: ${JSON.stringify(text)}`);
	let total = 0;
	let last = -1;
	for (const [, n, unit] of text.matchAll(/(\d+)(ms|h|m|s)/g)) {
		const i = ORDER.indexOf(unit);
		if (i <= last) throw new RangeError(`bad duration: ${JSON.stringify(text)} (units must go from largest to smallest, once each)`);
		last = i;
		total += Number(n) * UNIT[unit];
	}
	return total;
}
