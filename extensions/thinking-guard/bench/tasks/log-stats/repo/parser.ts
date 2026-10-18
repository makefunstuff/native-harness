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

export function parseLine(line: string): Entry {
	const parts = line.split(/\s+/);
	const time = new Date(parts[0].slice(0, 19) + "Z");
	return {
		time,
		method: parts[1],
		path: parts[2],
		status: parseInt(parts[3], 10),
		latencyMs: parseInt(parts[4].replace(/ms$/, ""), 10),
	};
}

export function p95Latency(lines: string[]): number {
	const values = lines.map((l) => parseLine(l).latencyMs).sort((a, b) => a - b);
	return values[Math.floor(values.length * 0.95)];
}
