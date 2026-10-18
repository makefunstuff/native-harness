// Command line: fetch URL [--timeout-ms N]
import { DEFAULT_TIMEOUT_MS } from "./httpUtil.ts";

export class UsageError extends Error {}

export function helpText(): string {
	return [
		"usage: fetch URL [--timeout-ms N]",
		`  --timeout-ms N   request timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS})`,
		"  --timeout S      deprecated: request timeout in seconds; use --timeout-ms",
	].join("\n");
}

export function parseArgs(argv: string[]): { url: string; timeoutMs: number } {
	let url: string | undefined;
	let ms: number | undefined;
	let secs: number | undefined;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--timeout-ms") ms = Number(argv[++i]);
		else if (argv[i] === "--timeout") secs = Number(argv[++i]);
		else if (argv[i].startsWith("-")) throw new UsageError(`unknown option ${argv[i]}`);
		else url = argv[i];
	}
	if (ms !== undefined && secs !== undefined) throw new UsageError("--timeout-ms and --timeout cannot be combined");
	if (!url) throw new UsageError("missing URL");
	return { url, timeoutMs: ms ?? (secs !== undefined ? Math.round(secs * 1000) : DEFAULT_TIMEOUT_MS) };
}
