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

export function parseLine(line: string): Entry {
	const [ts, method, path, status, dur] = line.trim().split(/\s+/);
	return { at: new Date(ts.slice(0, 19) + "Z"), method, path, status: Number(status), ms: Number(dur.replace("ms", "")) };
}

export function summarize(lines: string[]): Summary {
	const entries = lines.filter((l) => l.trim()).map(parseLine);
	const byHourUtc: Record<string, number> = {};
	for (const e of entries) {
		const key = e.at.toISOString().slice(0, 13);
		byHourUtc[key] = (byHourUtc[key] ?? 0) + 1;
	}
	const ms = entries.map((e) => e.ms).sort((a, b) => a - b);
	const p95Ms = ms.length ? ms[Math.floor(ms.length * 0.95)] ?? ms[ms.length - 1] : null;
	return { count: entries.length, malformed: 0, p95Ms, byHourUtc };
}
