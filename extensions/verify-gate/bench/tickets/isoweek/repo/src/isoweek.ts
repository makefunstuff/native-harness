// ISO 8601 week helpers (UTC).
const DAY = 86_400_000;

function dayOfYear(d: Date): number {
	return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1;
}

export function isoWeek(date: Date): { year: number; week: number } {
	return { year: date.getUTCFullYear(), week: Math.ceil(dayOfYear(date) / 7) };
}

export function weeksInYear(year: number): number {
	return isoWeek(new Date(Date.UTC(year, 11, 31))).week;
}

export function formatWeek(date: Date): string {
	const { year, week } = isoWeek(date);
	return `${year}-W${String(week).padStart(2, "0")}`;
}
