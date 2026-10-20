// Driving pi in-process through its SDK (createAgentSession): the shape every pi-extras bench uses.
//
// Each run works on a fresh copy of a ticket repo, with the human's pi config copied to
// ~/.cache/pi-extras/<bench>/pi-agent (sessions and backups left out), so the real config is never
// touched and the run sees the same settings, models, credentials and built-in extensions as the CLI.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createAgentSession,
	createCodemodeExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	type SessionEntry,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

export interface AgentCopyOpts {
	/** Where the copy lives: <cache>/pi-agent/<name>. */
	cache: string;
	name: string;
	/** Drop the user's installs of these (a bench loads the extension itself). */
	dropPackages?: RegExp;
	/** Idle timeout for a shared local server that can queue a request for minutes. */
	httpIdleTimeoutMs?: number;
}

/** A working copy of ~/.pi/agent (PI_AGENT_SRC) without sessions; nothing in the real one changes. */
export function agentCopy({ cache, name, dropPackages = /pi-extras|native-harness/, httpIdleTimeoutMs = 1_800_000 }: AgentCopyOpts): string {
	const src = process.env.PI_AGENT_SRC ?? join(homedir(), ".pi", "agent");
	const dest = join(cache, "pi-agent", name);
	rmSync(dest, { recursive: true, force: true });
	mkdirSync(dest, { recursive: true });
	if (existsSync(src))
		cpSync(src, dest, {
			recursive: true,
			verbatimSymlinks: true,
			filter: (p) => {
				const rel = p.slice(src.length).replace(/^\/+/, "");
				const base = rel.split("/").pop() ?? "";
				return !(rel === "sessions" || rel.startsWith("sessions/") || base.endsWith("~") || base.includes(".pre-") || base.includes(".bak"));
			},
		});
	mkdirSync(join(dest, "sessions"), { recursive: true });
	const sp = join(dest, "settings.json");
	const s = existsSync(sp) ? JSON.parse(readFileSync(sp, "utf8")) : {};
	const keep = (x: any) => !dropPackages.test(typeof x === "string" ? x : (x?.source ?? ""));
	s.packages = (s.packages ?? []).filter(keep);
	s.extensions = (s.extensions ?? []).filter(keep);
	if (httpIdleTimeoutMs) s.httpIdleTimeoutMs = httpIdleTimeoutMs;
	writeFileSync(sp, JSON.stringify(s, null, 2));
	return dest;
}

export interface SessionOpts {
	cwd: string;
	agentDir: string;
	/** `provider/model-id[:thinking]`. */
	model: string;
	/**
	 * Where the session (the full transcript: system prompt, tool output) is written. Keep it outside
	 * the work tree: the work tree is deleted after the run, and the transcript is not repo data.
	 */
	sessionDir?: string;
	/** Loaded like `pi -e` (an extension file of this checkout). */
	extensionPaths?: string[];
	/** Inline extension factories, e.g. an extension configured for one arm. */
	extensionFactories?: any[];
	/** Built-in extensions to load (codemode and tool search as the CLI does, by default). */
	builtins?: Array<"codemode" | "tool_search">;
}

export interface OpenedSession {
	session: any;
	sessionManager: SessionManager;
	modelRuntime: ModelRuntime;
	settingsManager: SettingsManager;
	resourceLoader: DefaultResourceLoader;
	entries: () => SessionEntry[];
	dispose: () => void;
}

/** Create one agent session the way the CLI would, with these overrides. */
export async function openSession(o: SessionOpts): Promise<OpenedSession> {
	const [ref, thinking] = o.model.split(":");
	const slash = ref.indexOf("/");
	if (slash < 0) throw new Error(`model must be provider/id[:thinking], got "${o.model}"`);
	const modelRuntime = await ModelRuntime.create({ authPath: join(o.agentDir, "auth.json"), modelsPath: join(o.agentDir, "models.json") });
	const model = modelRuntime.getModel(ref.slice(0, slash), ref.slice(slash + 1));
	if (!model) throw new Error(`unknown model ${ref}`);
	const settingsManager = SettingsManager.create(o.cwd, o.agentDir);
	// The CLI trusts a folder whose project resources are only settings/verify hooks; do the same.
	settingsManager.setProjectTrusted(true);
	const extensionFactories = (o.builtins ?? ["codemode", "tool_search"]).map((b) => (b === "codemode" ? createCodemodeExtension() : createToolSearchExtension()));
	extensionFactories.push(...(o.extensionFactories ?? []));
	const resourceLoader = new DefaultResourceLoader({
		cwd: o.cwd,
		agentDir: o.agentDir,
		settingsManager,
		extensionFactories,
		additionalExtensionPaths: o.extensionPaths ?? [],
	});
	await resourceLoader.reload();
	const sessionManager = SessionManager.create(o.cwd, o.sessionDir);
	const { session } = await createAgentSession({
		cwd: o.cwd,
		agentDir: o.agentDir,
		modelRuntime,
		model,
		thinkingLevel: thinking as any,
		settingsManager,
		resourceLoader,
		sessionManager,
	});
	return { session, sessionManager, modelRuntime, settingsManager, resourceLoader, entries: () => sessionManager.getEntries(), dispose: () => session.dispose() };
}

export interface PromptResult {
	wall_s: number;
	timed_out: boolean;
	error: string | null;
}

/** One prompt, aborted after timeoutS. Never throws: a provider failure becomes `error`. */
export async function runPrompt(session: any, prompt: string, timeoutS: number): Promise<PromptResult> {
	const t0 = Date.now();
	let timedOut = false;
	let error: string | null = null;
	const timer = setTimeout(() => {
		timedOut = true;
		void session.abort();
	}, timeoutS * 1000);
	try {
		await session.bindExtensions({});
		await session.prompt(prompt);
	} catch (e) {
		error = String((e as Error)?.message ?? e);
	} finally {
		clearTimeout(timer);
	}
	return { wall_s: Math.round(((Date.now() - t0) / 1000) * 10) / 10, timed_out: timedOut, error };
}

/** A prompt, then a manual /compact, then more prompts (the long-context scenario). */
export async function runSteps(session: any, steps: { prompt?: string; compact?: string }[], timeoutS: number) {
	const out: { kind: "prompt" | "compact"; s: number; ok: boolean; tokensBefore?: number; estimatedTokensAfter?: number; summary_chars?: number; usage?: any; error?: string }[] = [];
	for (const st of steps) {
		const t0 = Date.now();
		const timer = setTimeout(() => void session.abort(), timeoutS * 1000);
		try {
			if (st.compact !== undefined) {
				const r = await session.compact(st.compact || undefined);
				out.push({
					kind: "compact", s: Math.round(((Date.now() - t0) / 1000) * 100) / 100, ok: true,
					tokensBefore: r?.tokensBefore, estimatedTokensAfter: r?.estimatedTokensAfter, summary_chars: (r?.summary ?? "").length, usage: r?.usage,
				});
			} else {
				await session.prompt(st.prompt!);
				out.push({ kind: "prompt", s: Math.round(((Date.now() - t0) / 1000) * 100) / 100, ok: true });
			}
		} catch (e) {
			out.push({ kind: st.compact !== undefined ? "compact" : "prompt", s: Math.round(((Date.now() - t0) / 1000) * 100) / 100, ok: false, error: String((e as Error)?.message ?? e) });
		} finally {
			clearTimeout(timer);
		}
	}
	return out;
}
