// Durations like "90s", "5m" or "2h", in milliseconds.
const UNIT: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

export function parseDuration(text: string): number {
	const m = text.match(/^(\d+)([smh])$/);
	if (!m) throw new RangeError(`bad duration: ${JSON.stringify(text)}`);
	return Number(m[1]) * UNIT[m[2]];
}
