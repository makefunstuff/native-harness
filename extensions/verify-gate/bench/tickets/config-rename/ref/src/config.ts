// Service configuration, loaded from a parsed JSON object.
export class ConfigError extends Error {}

export interface Config {
	host: string;
	port: number;
	requestTimeoutMs: number;
}

export function loadConfig(raw: Record<string, unknown>, warn: (message: string) => void = console.warn): Config {
	const host = raw.host ?? "localhost";
	const port = raw.port ?? 8080;
	if (typeof host !== "string") throw new ConfigError("host must be a string");
	if (typeof port !== "number" || !Number.isInteger(port)) throw new ConfigError("port must be an integer");
	const hasNew = raw.requestTimeoutMs !== undefined;
	const hasOld = raw.timeout !== undefined;
	if (hasNew && hasOld) throw new ConfigError("give requestTimeoutMs or the deprecated timeout, not both");
	let requestTimeoutMs = 30000;
	if (hasOld) {
		const t = raw.timeout;
		if (typeof t !== "number" || !(t > 0)) throw new ConfigError("timeout must be a positive number of seconds");
		warn("config: `timeout` (seconds) is deprecated, use `requestTimeoutMs` (milliseconds)");
		requestTimeoutMs = Math.round(t * 1000);
	} else if (hasNew) {
		const t = raw.requestTimeoutMs;
		if (typeof t !== "number" || !Number.isInteger(t) || t <= 0) throw new ConfigError("requestTimeoutMs must be a positive integer");
		requestTimeoutMs = t;
	}
	return { host, port, requestTimeoutMs };
}
