// A calendar day is a "YYYY-MM-DD" string. Internally a day is a Date at 00:00 UTC.

export type Day = string;

export class DayError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "DayError";
		this.code = code;
	}
}

export function parseDay(s: Day): Date {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
	if (!m) throw new DayError("INVALID_DAY", `not a YYYY-MM-DD day: ${s}`);
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	if (d.getUTCMonth() !== Number(m[2]) - 1) throw new DayError("INVALID_DAY", `no such day: ${s}`);
	return d;
}

export function formatDay(d: Date): Day {
	return d.toISOString().slice(0, 10);
}

export function addDays(day: Day, n: number): Day {
	const d = parseDay(day);
	d.setUTCDate(d.getUTCDate() + n);
	return formatDay(d);
}

// 0 = Sunday … 6 = Saturday
export function weekday(day: Day): number {
	return parseDay(day).getUTCDay();
}
