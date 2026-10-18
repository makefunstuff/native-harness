// Service configuration, loaded from a parsed JSON object.
export class ConfigError extends Error {}

export interface Config {
	host: string;
	port: number;
	timeout: number; // seconds
}

export function loadConfig(raw: Record<string, unknown>): Config {
	const host = raw.host ?? "localhost";
	const port = raw.port ?? 8080;
	const timeout = raw.timeout ?? 30;
	if (typeof host !== "string") throw new ConfigError("host must be a string");
	if (typeof port !== "number" || !Number.isInteger(port)) throw new ConfigError("port must be an integer");
	if (typeof timeout !== "number" || timeout <= 0) throw new ConfigError("timeout must be a positive number");
	return { host, port, timeout };
}
