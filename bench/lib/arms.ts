// Arm definitions for benches: what a "side" of an A/B is (an extension, a config, a provider).
//
// An arm set is chosen with --bench; each set declares the tickets it runs and the arms that are
// comparable on them. Arms whose dependency is missing report why and are skipped — a bench that
// silently measures nothing is worse than one that says it cannot run.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { d3Context, readConfig, type D3Config } from "../../experimental/d3-context/extension/index.ts";
import type { RunContext, RunHooks } from "./run.ts";
import { loadTickets, type Ticket } from "./tickets.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface Arm {
	name: string;
	/** Constant fields added to every row of this arm. */
	fields?: Record<string, any>;
	model?: string;
	extensionPaths?: string[];
	/** Fresh factories per run: a run's config (log path, flags) is its own. */
	factories?: (ctx: RunContext, cfg: ArmConfig) => any[];
	env?: (ctx: RunContext, cfg: ArmConfig) => Record<string, string>;
	hooks?: (ctx: RunContext, cfg: ArmConfig) => RunHooks;
	/** A string means: skip this arm, and say why. */
	available?: () => true | string;
	maxWorkers?: number;
}

export interface ArmSet {
	name: string;
	/** Root of the tickets this set runs (default bench/tickets). */
	ticketRoot: string;
	/** Root for results/raw/<arm>.jsonl and the bench cache. */
	resultsRoot: string;
	cacheName: string;
	defaultModel: string;
	arms: Arm[];
}

export interface ArmConfig {
	dryRun: boolean;
	[key: string]: any;
}

const ext = (p: string) => join(ROOT, p);

export const EXTENSIONS = {
	"verify-gate": ext("extensions/verify-gate/index.ts"),
	"loop-guard": ext("extensions/loop-guard/index.ts"),
	"thinking-guard": ext("extensions/thinking-guard/index.ts"),
	lessons: ext("extensions/lessons/index.ts"),
	"local-edit": ext("extensions/local-edit/index.ts"),
	"d3-context": ext("experimental/d3-context/extension/index.ts"),
	"llama-native": ext("experimental/llama-native/extension/index.ts"),
};

/** The pi-extras arms: each extension against a plain pi, on the shared tickets. */
export function piExtrasSet(): ArmSet {
	return {
		name: "pi-extras",
		ticketRoot: join(ROOT, "bench", "tickets"),
		resultsRoot: join(ROOT, "bench", "results"),
		cacheName: "pi-extras",
		defaultModel: process.env.BENCH_MODEL ?? "deepseek-flash",
		arms: [
			{ name: "off", fields: { gate: "none" } },
			...Object.entries(EXTENSIONS)
				.filter(([name]) => name !== "llama-native" && name !== "d3-context")
				.map(([name, path]) => ({
					name,
					fields: { gate: name },
					extensionPaths: [path],
				})),
		],
	};
}

/** The d3-context arms: the context router against a plain pi, on the long tickets. */
export function d3ContextSet(): ArmSet {
	const cfg: D3Config = readConfig();
	return {
		name: "d3-context",
		ticketRoot: join(ROOT, "experimental", "d3-context", "bench", "tasks-long"),
		resultsRoot: join(ROOT, "experimental", "d3-context", "results"),
		cacheName: "d3-context",
		defaultModel: process.env.BENCH_MODEL ?? "deepseek-flash",
		arms: [
			{ name: "base", fields: { gate: "none" } },
			{
				name: "d3",
				fields: { gate: "d3", d3_model: cfg.model },
				available: () => (cfg.url ? true : "no D3 endpoint: set D3_URL (see experimental/d3-context/README.md)"),
				factories: (ctx) => [(pi: any) => d3Context(pi, { ...cfg, log: join(ctx.outDir, `${ctx.name}.d3.jsonl`) })],
			},
		],
	};
}

const llamaAddon = join(ROOT, "experimental", "llama-native", "native", "build", "llama_native.node");

/** The llama-native arms: the llama.cpp in-process provider, through the measuring proxy. */
export function llamaNativeSet(): ArmSet {
	const exp = process.env.LLAMA_NATIVE_EXP ?? "";
	return {
		name: "llama-native",
		ticketRoot: join(ROOT, "bench", "tickets"),
		resultsRoot: join(ROOT, "experimental", "llama-native", "results"),
		cacheName: "llama-native",
		defaultModel: process.env.BENCH_MODEL ?? "local-ai/llama-native/qwen3.8-27b",
		arms: [
			{
				name: exp ? `native-${exp.replaceAll(",", "-")}` : "native",
				fields: { gate: "native", exp },
				available: () => (existsSync(llamaAddon) ? true : `no local build: ${llamaAddon.replace(process.env.HOME ?? "", "~")} (cd experimental/llama-native && ./scripts/build.sh)`),
				maxWorkers: 1,
			},
		],
	};
}

export function armSet(name: string): ArmSet {
	switch (name) {
		case "pi-extras":
			return piExtrasSet();
		case "d3-context":
			return d3ContextSet();
		case "llama-native":
			return llamaNativeSet();
		default:
			throw new Error(`unknown --bench ${name} (pi-extras | d3-context | llama-native)`);
	}
}

export function pickTickets(root: string, spec: string): Ticket[] {
	const all = loadTickets(root);
	if (spec === "all" || !spec) return all;
	const want = spec.split(",").map((s) => s.trim()).filter(Boolean);
	const missing = want.filter((w) => !all.some((t) => t.name === w));
	if (missing.length) throw new Error(`no ticket named ${missing.join(", ")} in ${root}`);
	return all.filter((t) => want.includes(t.name));
}
