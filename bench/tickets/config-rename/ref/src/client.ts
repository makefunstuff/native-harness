import type { Config } from "./config.ts";

export function requestOptions(cfg: Config): { url: string; timeoutMs: number } {
	return { url: `http://${cfg.host}:${cfg.port}/`, timeoutMs: cfg.requestTimeoutMs };
}
