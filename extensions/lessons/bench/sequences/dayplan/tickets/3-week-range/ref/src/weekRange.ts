import { type Day, addDays, weekday } from "./dates.ts";

/**
 * The Monday and Sunday of the ISO week `day` is in.
 * @example isoWeekRange("2026-10-22") // ["2026-10-19", "2026-10-25"]
 */
export function isoWeekRange(day: Day): [Day, Day] {
	const back = (weekday(day) + 6) % 7; // days since Monday
	const monday = addDays(day, -back);
	return [monday, addDays(monday, 6)];
}
