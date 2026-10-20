import type { Config } from "./config.ts";

export function describe(cfg: Config): string {
	return `listening on ${cfg.host}:${cfg.port}, timeout ${cfg.timeout} s`;
}
