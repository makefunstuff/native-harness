// ISO 8601 week helpers (UTC).
const DAY = 86_400_000;

export function isoWeek(date: Date): { year: number; week: number } {
	const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
	const weekday = (new Date(day).getUTCDay() + 6) % 7; // Monday = 0
	const thursday = new Date(day + (3 - weekday) * DAY);
	const year = thursday.getUTCFullYear();
	const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
	return { year, week };
}

export function weeksInYear(year: number): number {
	return isoWeek(new Date(Date.UTC(year, 11, 28))).week; // Dec 28 is always in the last week
}

export function formatWeek(date: Date): string {
	const { year, week } = isoWeek(date);
	return `${year}-W${String(week).padStart(2, "0")}`;
}
