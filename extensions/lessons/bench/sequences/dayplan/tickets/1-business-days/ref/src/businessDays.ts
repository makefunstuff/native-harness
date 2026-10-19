import { type Day, formatDay, parseDay } from "./dates.ts";

/**
 * The day `n` business days after `day` (before it for negative `n`), skipping weekends.
 * @example addBusinessDays("2026-10-16", 1) // "2026-10-19"
 */
export function addBusinessDays(day: Day, n: number): Day {
	const d = parseDay(day);
	const step = n < 0 ? -1 : 1;
	let left = Math.abs(n);
	while (left > 0) {
		d.setUTCDate(d.getUTCDate() + step);
		const wd = d.getUTCDay();
		if (wd !== 0 && wd !== 6) left--;
	}
	return formatDay(d);
}
