// Per-request metrics as JSONL: LLAMA_NATIVE_METRICS, or the path written in "<that>.target"
// (the benchmark switches it per task).
import { appendFileSync, readFileSync } from "node:fs";

function metricsPath(): string | undefined {
	const p = process.env.LLAMA_NATIVE_METRICS;
	if (!p) return undefined;
	try {
		const t = readFileSync(p + ".target", "utf8").trim();
		if (t) return t;
	} catch {}
	return p;
}

export function logMetrics(rec: any) {
	const p = metricsPath();
	if (p) appendFileSync(p, JSON.stringify({ t: Date.now() / 1000, ...rec }) + "\n");
}
