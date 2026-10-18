// Access-log statistics.

export interface Entry {
	time: Date;
	method: string;
	path: string;
	status: number;
	ms: number;
}

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function parseLine(line: string): Entry {
	const parts = line.split(" ");
	if (parts.length !== 5) throw new RangeError(`malformed line: ${line}`);
	const [ts, method, path, status, latency] = parts;
	const time = new Date(ts);
	if (!TS.test(ts) || Number.isNaN(time.getTime())) throw new RangeError(`bad timestamp: ${ts}`);
	if (!/^\d+$/.test(status)) throw new RangeError(`bad status: ${status}`);
	const m = /^(\d+)ms$/.exec(latency);
	if (!m) throw new RangeError(`bad latency: ${latency}`);
	return { time, method, path, status: Number(status), ms: Number(m[1]) };
}

export function p95Latency(lines: string[]): number {
	if (!lines.length) throw new RangeError("no lines");
	const values = lines.map((l) => parseLine(l).ms).sort((a, b) => a - b);
	return values[Math.ceil(0.95 * values.length) - 1];
}
