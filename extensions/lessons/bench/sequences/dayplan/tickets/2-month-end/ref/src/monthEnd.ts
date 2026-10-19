import { type Day, formatDay, parseDay } from "./dates.ts";

/**
 * The last day of the month `day` is in.
 * @example endOfMonth("2026-02-10") // "2026-02-28"
 */
export function endOfMonth(day: Day): Day {
	const d = parseDay(day);
	return formatDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/**
 * Whether `day` is the last day of its month.
 * @example isLastDayOfMonth("2026-04-30") // true
 */
export function isLastDayOfMonth(day: Day): boolean {
	return endOfMonth(day) === formatDay(parseDay(day));
}
