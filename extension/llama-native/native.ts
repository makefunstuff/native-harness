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
let pendingHelper: Promise<Native> | undefined;

export function defaultAddon(): string {
	return process.env.LLAMA_NATIVE_ADDON ?? join(HERE, "../../native/build/llama_native.node");
}

// the main model; a second sequence is needed for decisions / summaries on a fork of the cache
export function getNative(argsFile: string, addonPath: string): Promise<Native> {
	if (pending) return pending;
	pending = load(addonPath, [...readArgs(argsFile), "--parallel", "2", ...(process.env.LLAMA_NATIVE_EXTRA_ARGS?.split(/\s+/).filter(Boolean) ?? [])]);
	pending.catch(() => (pending = undefined));
	return pending;
}

// a second, small model in the same process (LLAMA_NATIVE_HELPER_ARGS)
export function getHelper(): Promise<Native> {
	if (pendingHelper) return pendingHelper;
	const f = process.env.LLAMA_NATIVE_HELPER_ARGS;
	if (!f) return Promise.reject(new Error("LLAMA_NATIVE_HELPER_ARGS is not set"));
	pendingHelper = load(defaultAddon(), readArgs(f));
	pendingHelper.catch(() => (pendingHelper = undefined));
	return pendingHelper;
}

function load(addonPath: string, args: string[]): Promise<Native> {
	return (async () => {
		const m = require_(addonPath);
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
}
