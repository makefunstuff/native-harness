// Command line: fetch URL [--timeout S]
import { DEFAULT_TIMEOUT } from "./httpUtil.ts";

export class UsageError extends Error {}

export function helpText(): string {
	return ["usage: fetch URL [--timeout S]", `  --timeout S   request timeout in seconds (default ${DEFAULT_TIMEOUT})`].join("\n");
}

export function parseArgs(argv: string[]): { url: string; timeout: number } {
	let url: string | undefined;
	let timeout = DEFAULT_TIMEOUT;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--timeout") timeout = Number(argv[++i]);
		else if (argv[i].startsWith("-")) throw new UsageError(`unknown option ${argv[i]}`);
		else url = argv[i];
	}
	if (!url) throw new UsageError("missing URL");
	return { url, timeout };
}
