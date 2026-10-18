// llama-native (experimental): llama.cpp inside pi's own process, as provider "llama-native".
// See ../README.md and provider.ts.
//
// Without the built addon this extension does nothing: only Node built-ins are imported here, and
// the provider code (pi-ai, the experiments) is loaded only once the addon exists.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(realpathSync(fileURLToPath(import.meta.url)));

export function addonPath(): string {
	return process.env.LLAMA_NATIVE_ADDON ?? resolve(HERE, "../native/build/llama_native.node");
}

export default async function (pi: ExtensionAPI) {
	if (!existsSync(addonPath())) return; // not built: stay out of the way
	const { install } = await import("./provider.ts");
	install(pi);
}
