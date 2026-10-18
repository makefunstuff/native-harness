// Lazy, process-wide handle on the in-process model. Loading happens on the first request (never
// in the extension factory, which pi also runs for commands that start no session).
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
	return process.env.LLAMA_NATIVE_ADDON ?? join(HERE, "../native/build/llama_native.node");
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
	pendingHelper = load(defaultAddon(), readArgs(f), Number(process.env.LLAMA_NATIVE_HELPER_MIN_FREE_MIB ?? 0));
	pendingHelper.catch(() => (pendingHelper = undefined));
	return pendingHelper;
}

// The model needs the GPUs like a router preset does. Refuse to load next to another resident
// model (e.g. the shared llama.cpp router) rather than fail half-way with an out-of-memory error.
function checkVram(minFreeMiB: number) {
	if (minFreeMiB <= 0) return;
	let out = "";
	try {
		out = execFileSync("nvidia-smi", ["--query-gpu=index,memory.free", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 10000 });
	} catch {
		return; // no nvidia-smi: let llama.cpp decide
	}
	const busy = out.trim().split("\n").map((l) => l.split(",").map((x) => x.trim())).filter(([, f]) => Number(f) < minFreeMiB);
	if (busy.length)
		throw new Error(`llama-native: not enough free VRAM (GPU ${busy.map(([i, f]) => `${i}: ${f} MiB free`).join(", ")}; need ${minFreeMiB} MiB). ` +
			"Is a llama.cpp router model loaded? Unload it or use the llama.cpp provider.");
}

function load(addonPath: string, args: string[], minFreeMiB = Number(process.env.LLAMA_NATIVE_MIN_FREE_MIB ?? 13500)): Promise<Native> {
	return (async () => {
		checkVram(minFreeMiB);
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
