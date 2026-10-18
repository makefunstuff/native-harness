// Lazy, process-wide handle on the in-process model. Loading happens on the first request (never
// in the extension factory, which pi also runs for commands that start no session).
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(realpathSync(fileURLToPath(import.meta.url)));
const require_ = createRequire(join(HERE, "native.ts"));
const { readArgs } = require_("./args.cjs");

export interface Native {
	chat(req: any, onDelta: (d: any) => void): Promise<any>;
	decide(req: any): Promise<any>;
	branchComplete(req: any): Promise<any>;
	info(): Promise<any>;
	reset(): Promise<any>;
	abort(): void;
	loadMs: number;
}

let pending: Promise<Native> | undefined;

export function getNative(argsFile: string, addonPath: string): Promise<Native> {
	if (pending) return pending;
	pending = (async () => {
		const m = require_(addonPath);
		// a second sequence is needed for decisions / summaries on a fork of the cache
		const args = [...readArgs(argsFile), "--parallel", "2", ...(process.env.LLAMA_NATIVE_EXTRA_ARGS?.split(/\s+/).filter(Boolean) ?? [])];
		const t0 = performance.now();
		const h = await m.load(args);
		const loadMs = performance.now() - t0;
		const j = async (p: Promise<string>) => JSON.parse(await p);
		return {
			chat: (req, onDelta) => j(m.chat(h, JSON.stringify(req), (s: string) => onDelta(JSON.parse(s)))),
			decide: (req) => j(m.decide(h, JSON.stringify(req))),
			branchComplete: (req) => j(m.branchComplete(h, JSON.stringify(req))),
			info: () => j(m.info(h)),
			reset: () => j(m.reset(h)),
			abort: () => m.abort(h),
			loadMs,
		} as Native;
	})();
	pending.catch(() => (pending = undefined));
	return pending;
}
