// Summaries of access log lines: "<ISO timestamp with offset> <method> <path> <status> <N>ms".
export interface Entry {
	at: Date;
	method: string;
	path: string;
	status: number;
	ms: number;
}

export interface Summary {
	count: number;
	malformed: number;
	p95Ms: number | null;
	byHourUtc: Record<string, number>;
}

const TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function parseLine(line: string): Entry | null {
	const f = line.trim().split(/\s+/);
	if (f.length !== 5) return null;
	const [ts, method, path, status, dur] = f;
	const m = ts.match(TS);
	if (!m) return null;
	const at = new Date(ts);
	if (Number.isNaN(at.getTime())) return null;
	const [, y, mo, d, h, mi, s] = m.map(Number);
	if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
	if (!/^\d{3}$/.test(status) || !/^\d+ms$/.test(dur)) return null;
	return { at, method, path, status: Number(status), ms: Number(dur.slice(0, -2)) };
}

export function summarize(lines: string[]): Summary {
	const entries: Entry[] = [];
	let malformed = 0;
	for (const l of lines) {
		if (!l.trim()) continue;
		const e = parseLine(l);
		if (e) entries.push(e);
		else malformed++;
	}
	const byHourUtc: Record<string, number> = {};
	for (const e of entries) {
		const key = e.at.toISOString().slice(0, 13);
		byHourUtc[key] = (byHourUtc[key] ?? 0) + 1;
	}
	const ms = entries.map((e) => e.ms).sort((a, b) => a - b);
	const p95Ms = ms.length ? ms[Math.ceil(ms.length * 0.95) - 1] : null;
	return { count: entries.length, malformed, p95Ms, byHourUtc };
}
