// lessons: learn from mistakes that were fixed, across sessions.
//
// - When something failed in a session and was then fixed (a command exited non-zero, and later
//   the same command, or any check, passed), the agent is asked once, at the end of the run, to
//   write a short cue / lesson / evidence / confidence note. The request is appended after its
//   last answer, so the prompt cache survives.
// - At the start of the next task in the same repository, the few notes whose cue matches the
//   task are recalled (Hindsight's semantic search, the memory behind homelab-tools'
//   memory_recall; a local file with plain-text matching otherwise), a decision model (Jev) keeps
//   the ones that apply, and those are appended after the user's prompt. No match, no text: the
//   extension adds nothing to the system prompt and no tool.
// - Notes are capped in size and number, merged when they say the same thing, lose confidence
//   when the agent reports them wrong and are deleted below a floor, and expire when unused.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { FixTracker } from "./detect.ts";
import { judge } from "./judge.ts";
import { type Note, askMessage, lessonsMessage, makeNote, parseReply } from "./note.ts";
import { CONFIRMED, CONTRADICTED, DEFAULT_LIBRARY, FileStore, HindsightStore, Library } from "./store.ts";

export const CUSTOM_TYPE = "lessons";

export interface Config {
	enabled: boolean;
	store: "auto" | "hindsight" | "file";
	dir: string;
	hindsight: { url?: string; bank: string; keyFile: string; timeoutMs: number };
	judge: string; // "auto" | "off" | "provider/id"
	k: number; // notes shown at most
	candidates: number; // notes recalled before judging
	minP: number; // classifier probability to keep a note
	minHindsight: number; // Hindsight score to keep a note when there is no classifier
	minText: number; // plain-text cover to keep a note when there is no classifier
	maxNotes: number;
	ttlDays: number;
	repo?: string;
}

export function readConfig(env: Record<string, string | undefined> = process.env): Config {
	const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
	const agentDir = env.PI_CODING_AGENT_DIR?.replace(/^~(?=$|\/)/, homedir()) ?? join(homedir(), ".pi", "agent");
	const store = (env.LESSONS_STORE ?? "auto").toLowerCase();
	return {
		enabled: !["0", "off", "false", "no"].includes((env.LESSONS ?? "on").toLowerCase()),
		store: store === "hindsight" || store === "file" ? store : "auto",
		dir: env.LESSONS_DIR ?? join(agentDir, "lessons"),
		hindsight: {
			url: env.HINDSIGHT_URL,
			bank: env.LESSONS_HINDSIGHT_BANK ?? env.HINDSIGHT_BANK ?? "omp-shared",
			keyFile: env.HINDSIGHT_KEY_FILE ?? join(homedir(), ".config", "opencode", "credentials", "hindsight.key"),
			timeoutMs: num(env.LESSONS_HINDSIGHT_TIMEOUT, 60) * 1000,
		},
		judge: env.LESSONS_JUDGE ?? "auto",
		k: Math.max(1, Math.floor(num(env.LESSONS_K, 3))),
		candidates: Math.max(1, Math.floor(num(env.LESSONS_CANDIDATES, 8))),
		minP: num(env.LESSONS_MIN_P, 0.5),
		minHindsight: num(env.LESSONS_MIN_SCORE, 0.3),
		minText: num(env.LESSONS_MIN_TEXT, 0.35),
		maxNotes: Math.max(1, Math.floor(num(env.LESSONS_MAX, 40))),
		ttlDays: num(env.LESSONS_TTL_DAYS, 180),
		repo: env.LESSONS_REPO || undefined,
	};
}

// A stable name for the repository at `cwd`: its origin remote (host/path, no credentials), else
// package.json's name, else the git top-level folder's name, else the folder's name.
export function repoKey(cwd: string): string {
	const git = (...a: string[]) => {
		const r = spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8", timeout: 5000 });
		return r.status === 0 ? r.stdout.trim() : "";
	};
	const remote = git("remote", "get-url", "origin");
	if (remote) {
		const m = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/i.exec(remote);
		if (m) return `${m[1]}/${m[2]}`.toLowerCase();
	}
	const top = git("rev-parse", "--show-toplevel") || cwd;
	try {
		const name = JSON.parse(readFileSync(join(top, "package.json"), "utf8"))?.name;
		if (typeof name === "string" && name.trim()) return name.trim();
	} catch {}
	return basename(top);
}

export function hindsightKey(file: string): string | undefined {
	try {
		return existsSync(file) ? readFileSync(file, "utf8").trim() || undefined : undefined;
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	lessons(pi, readConfig());
}

export function lessons(pi: ExtensionAPI, config: Config) {
	if (!config.enabled) return;

	const tracker = new FixTracker();
	let library: Library | undefined;
	let repo: string | undefined;
	let recalled = false; // lessons looked up for this session
	let shown: Array<{ label: string; note: Note }> = [];
	let asked = false; // the lesson request was sent for the current user prompt
	let awaiting = false; // the next assistant message answers it

	const say = (ctx: ExtensionContext, msg: string, level: "info" | "warning" = "info") => ctx.ui.notify(`lessons: ${msg}`, level);

	function setup(ctx: ExtensionContext): Library {
		if (library) return library;
		repo = config.repo ?? repoKey(ctx.cwd);
		const memoryTools = (pi.getAllTools() ?? []).some((t) => t.name === "memory_recall");
		const useHindsight = config.store === "hindsight" || (config.store === "auto" && (Boolean(config.hindsight.url) || memoryTools));
		const hs = useHindsight
			? new HindsightStore({
					url: config.hindsight.url ?? "http://127.0.0.1:18888",
					bank: config.hindsight.bank,
					key: hindsightKey(config.hindsight.keyFile),
					timeoutMs: config.hindsight.timeoutMs,
				})
			: undefined;
		library = new Library(new FileStore(config.dir), hs, { maxNotes: config.maxNotes, ttlDays: config.ttlDays, dropBelow: DEFAULT_LIBRARY.dropBelow, dedupe: DEFAULT_LIBRARY.dedupe });
		return library;
	}

	function classifier(ctx: ExtensionContext): { model?: any; name?: string } {
		if (config.judge === "off") return {};
		const [provider, id] = config.judge === "auto" ? ["jev-lan", "jev"] : [config.judge.slice(0, config.judge.indexOf("/")), config.judge.slice(config.judge.indexOf("/") + 1)];
		try {
			const model = ctx.modelRegistry.findOfType("classifier", provider, id);
			return model ? { model, name: `${provider}/${id}` } : {};
		} catch {
			return {};
		}
	}

	function flushErrors(ctx: ExtensionContext) {
		for (const e of library?.errors.splice(0) ?? []) say(ctx, e, "warning");
	}

	pi.on("session_start", () => {
		tracker.reset();
		library = undefined;
		repo = undefined;
		recalled = false;
		shown = [];
		asked = false;
		awaiting = false;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (event.messageType !== "user") return;
		asked = false;
		if (recalled) return;
		recalled = true;
		const lib = setup(ctx);
		const task = event.prompt ?? "";
		if (!task.trim()) return;
		const rec = await lib.recall(repo!, task, config.candidates, ctx.signal);
		if (rec.fallback) say(ctx, rec.fallback, "warning");
		const cls = classifier(ctx);
		if (config.judge !== "auto" && config.judge !== "off" && !cls.model) say(ctx, `classifier ${config.judge} not found; using the score threshold`, "warning");
		const j = await judge(task, rec.candidates, {
			k: config.k,
			minP: config.minP,
			registry: ctx.modelRegistry as any,
			model: cls.model,
			modelName: cls.name,
			minHindsight: config.minHindsight,
			minText: config.minText,
			signal: ctx.signal,
		});
		if (j.fallback) say(ctx, j.fallback, "warning");
		const details = {
			repo,
			source: rec.source,
			fallback: rec.fallback,
			judge: j.judge,
			judgeFallback: j.fallback,
			candidates: rec.candidates.map((c) => ({ id: c.note.id, score: Math.round(c.score * 1000) / 1000 })),
			kept: j.kept.map((c) => ({ id: c.note.id, p: c.p })),
			usage: j.usage,
		};
		if (!j.kept.length) {
			pi.appendEntry(CUSTOM_TYPE, { ...details, shown: [] });
			return;
		}
		shown = j.kept.map((c, i) => ({ label: `L${i + 1}`, note: c.note }));
		return {
			message: {
				customType: CUSTOM_TYPE,
				content: lessonsMessage(shown),
				display: true,
				details: { ...details, shown: shown.map((s) => ({ label: s.label, id: s.note.id })) },
			},
		};
	});

	pi.on("tool_result", (event) => {
		if (event.toolName !== "bash" || event.parentToolCallId) return;
		const command = String((event.input as any)?.command ?? "");
		const text = event.content.map((c: any) => (c.type === "text" ? c.text : "")).join("\n");
		const code = (event.structuredContent as any)?.exit_code;
		tracker.onBash(command, event.isError, text, typeof code === "number" ? code : undefined);
	});

	pi.on("agent_before_settle", (event) => {
		if (event.outcome !== "completed" || event.continue || asked || !tracker.fixes.length) return;
		asked = true;
		awaiting = true;
		const fixes = tracker.fixes.splice(0);
		const message = {
			type: "custom_message" as const,
			customType: CUSTOM_TYPE,
			content: askMessage(fixes, shown),
			display: true,
			details: { ask: true, fixes },
		};
		return { entries: [...event.entries, message], continue: true };
	});

	pi.on("message_end", async (event, ctx) => {
		const m: any = event.message;
		if (!awaiting || m?.role !== "assistant") return;
		awaiting = false;
		const text = (m.content ?? []).map((c: any) => (c.type === "text" ? c.text : "")).join("\n");
		const reply = parseReply(text);
		const lib = setup(ctx);
		const resolve = (ref: string) => shown.find((s) => s.label.toLowerCase() === ref.toLowerCase() || s.note.id === ref)?.note;
		const log: string[] = [];
		for (const ref of reply.contradicts) {
			const n = resolve(ref);
			if (n) log.push(`${ref} ${await lib.adjust(repo!, n, CONTRADICTED, ctx.signal)} (contradicted)`);
		}
		for (const ref of reply.confirms) {
			const n = resolve(ref);
			if (n && !reply.contradicts.includes(ref)) log.push(`${ref} confirmed`);
			if (n && !reply.contradicts.includes(ref)) await lib.adjust(repo!, n, CONFIRMED, ctx.signal);
		}
		for (const f of reply.notes.slice(0, 2)) {
			const r = await lib.save(makeNote(repo!, f), ctx.signal);
			log.push(`${r.action} "${r.note.cue}"${r.evicted.length ? `, evicted ${r.evicted.length}` : ""}`);
		}
		flushErrors(ctx);
		if (log.length) say(ctx, log.join("; "));
		pi.appendEntry(CUSTOM_TYPE, { reply: { notes: reply.notes.length, confirms: reply.confirms, contradicts: reply.contradicts }, log });
	});

	pi.registerCommand("lessons", {
		description: "List this repository's lessons, or `/lessons forget <id>`",
		handler: async (args, ctx) => {
			const lib = setup(ctx);
			const [verb, id] = (args ?? "").trim().split(/\s+/);
			if (verb === "forget" && id) {
				const ok = await lib.forget(repo!, id);
				flushErrors(ctx);
				say(ctx, ok ? `forgot ${id}` : `no lesson ${id} in ${repo}`);
				return;
			}
			const notes = lib.files.list(repo!);
			const where = lib.hindsight ? `Hindsight bank ${lib.hindsight.cfg.bank} + ${lib.files.dir}` : lib.files.dir;
			if (!notes.length) {
				say(ctx, `no lessons for ${repo} yet (${where})`);
				return;
			}
			say(ctx, `${notes.length} lesson(s) for ${repo} (${where}):\n${notes.map((n) => `${n.id} [${n.confidence.toFixed(2)}] When ${n.cue}: ${n.lesson}`).join("\n")}`);
		},
	});
}
