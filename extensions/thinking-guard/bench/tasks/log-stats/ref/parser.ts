// Parse access-log lines of the form:
//
//     2026-10-01T12:00:00+03:00 GET /api/items 200 123ms
export interface Entry {
	time: Date;
	method: string;
	path: string;
	status: number;
	latencyMs: number;
}

const LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2}))\s+(\S+)\s+(\S+)\s+(\d{3})\s+(\d+)ms$/;

export function parseLine(line: string): Entry {
	const m = LINE.exec(line.trim());
	if (!m) throw new SyntaxError(`malformed log line: ${JSON.stringify(line)}`);
	const time = new Date(m[1]);
	if (Number.isNaN(time.getTime())) throw new SyntaxError(`bad time: ${m[1]}`);
	return { time, method: m[2], path: m[3], status: Number(m[4]), latencyMs: Number(m[5]) };
}

export function p95Latency(lines: string[]): number {
	if (!lines.length) throw new RangeError("no lines");
	const values = lines.map((l) => parseLine(l).latencyMs).sort((a, b) => a - b);
	return values[Math.ceil(0.95 * values.length) - 1];
}
