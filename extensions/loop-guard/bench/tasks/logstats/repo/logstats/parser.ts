// Access-log statistics.

export interface Entry {
	time: Date;
	method: string;
	path: string;
	status: number;
	ms: number;
}

export function parseLine(line: string): Entry {
	const [ts, method, path, status, latency] = line.split(" ");
	return {
		time: new Date(ts.slice(0, 19)),
		method,
		path,
		status: Number(status),
		ms: Number(latency.replace("ms", "")),
	};
}

export function p95Latency(lines: string[]): number {
	const values = lines.map((l) => parseLine(l).ms).sort();
	return values[Math.floor(0.95 * values.length)];
}
