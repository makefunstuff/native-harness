// llama.cpp router preset files: global defaults, then [sections] of key = value.
import { readFileSync } from "node:fs";

export function loadPresets(path: string): Record<string, Record<string, string>> {
	const defaults: Record<string, string> = {};
	const sections = new Map<string, Record<string, string>>();
	let current: Record<string, string> | undefined;
	readFileSync(path, "utf8").split(/\r?\n/).forEach((raw, i) => {
		const line = raw.trim();
		if (!line || line.startsWith("#") || line.startsWith(";")) return;
		const header = line.match(/^\[(.+)\]$/);
		if (header) {
			const name = header[1].trim();
			if (sections.has(name)) throw new Error(`line ${i + 1}: duplicate section [${name}]`);
			current = {};
			sections.set(name, current);
			return;
		}
		const eq = line.indexOf("=");
		if (eq < 0) throw new Error(`line ${i + 1}: expected key = value or [section]`);
		(current ?? defaults)[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
	});
	const out: Record<string, Record<string, string>> = {};
	for (const [name, keys] of sections) out[name] = { ...defaults, ...keys };
	return out;
}

export function main(argv: string[], out: (line: string) => void = console.log): number {
	for (const [name, k] of Object.entries(loadPresets(argv[0]))) {
		out(`${name} ctx=${k["ctx-size"] ?? "-"} devices=${k.device ?? "-"} split=${k["split-mode"] ?? "layer"} draft=${"spec-draft-model" in k ? "yes" : "no"}`);
	}
	return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.exitCode = main(process.argv.slice(2));
