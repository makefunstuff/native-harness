import { type Day, parseDay } from "./dates.ts";

/**
 * Calendar days from `from` to `to`.
 * @example daysBetween("2026-10-19", "2026-10-26") // 7
 */
export function daysBetween(from: Day, to: Day): number {
	return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}
