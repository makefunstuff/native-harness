import { type Day, DayError, formatDay } from "./dates.ts";

/**
 * The `n`-th `weekday` (0 = Sunday) of a month; `n = -1` is the last one.
 * @example nthWeekdayOfMonth(2026, 3, 2, 2) // "2026-03-10"
 */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Day {
	if (n === -1) {
		const last = new Date(Date.UTC(year, month, 0));
		last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
		return formatDay(last);
	}
	const first = new Date(Date.UTC(year, month - 1, 1));
	const d = 1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7;
	const out = new Date(Date.UTC(year, month - 1, d));
	if (n < 1 || out.getUTCMonth() !== month - 1) throw new DayError("NO_SUCH_DAY", `no weekday ${weekday} number ${n} in ${year}-${month}`);
	return formatDay(out);
}
