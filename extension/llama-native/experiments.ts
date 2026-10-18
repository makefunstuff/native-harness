// Experiments, switched by LLAMA_NATIVE_EXP (comma-separated). Placeholder; filled in below.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Native } from "./native.ts";

export function experiments(): Set<string> {
	return new Set((process.env.LLAMA_NATIVE_EXP ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

// request flags passed to the binding
export function experimentFlags(): Record<string, unknown> {
	const e = experiments();
	return {
		cache_mode: e.has("server-cache") ? "server" : "segments",
		tool_grammar: !e.has("no-grammar"),
		use_spec: !e.has("no-spec"),
	};
}

export function installExperiments(pi: ExtensionAPI, native: () => Promise<Native>) {}
