// Shared test harness for pi-extras extensions.
//
//   startMockModel(respond)   a scriptable OpenAI-compatible chat-completions server on loopback
//   makeAgentDir(opts)        a throw-away pi config dir (a copy of ~/.pi/agent, or an empty one)
//                             with this package installed and the mock model added
//   runPi(agentDir, args)     run pi headless against that config dir
//
// Smoke tests (`*.smoke.mjs`, run by test/smoke.mjs) use these three to drive a real pi process
// end to end without a real model, so they also run in CI.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const MOCK_PROVIDER = "pi-extras-mock";
export const MOCK_MODEL = `${MOCK_PROVIDER}/mock`;

// respond(body, n) is called for every chat request (n counts from 0) and returns
//   { content: "text" }                                        a plain answer, or
//   { toolCalls: [{ name, arguments: {...} }], content? }      tool calls.
// Every request body is kept in `requests`.
export async function startMockModel(respond) {
	const requests = [];
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const chunk of req) body += chunk;
		if (req.method === "GET" && req.url.endsWith("/models")) {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ object: "list", data: [{ id: "mock", object: "model" }] }));
			return;
		}
		if (!req.url.endsWith("/chat/completions")) {
			res.writeHead(404).end();
			return;
		}
		const payload = JSON.parse(body || "{}");
		const n = requests.length;
		requests.push(payload);
		let answer;
		try {
			answer = await respond(payload, n);
		} catch (e) {
			res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: String(e?.message ?? e) } }));
			return;
		}
		res.writeHead(200, { "content-type": "text/event-stream" });
		const base = { id: `chatcmpl-mock-${n}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "mock" };
		const send = (delta, finish = null, extra = {}) =>
			res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
		send({ role: "assistant" });
		if (answer.content) send({ content: answer.content });
		(answer.toolCalls ?? []).forEach((c, i) =>
			send({ tool_calls: [{ index: i, id: `call_${n}_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } }] }),
		);
		const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
		send({}, answer.toolCalls?.length ? "tool_calls" : "stop", { usage });
		res.end("data: [DONE]\n\n");
	});
	await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
	const url = `http://127.0.0.1:${server.address().port}/v1`;
	return { url, requests, close: () => new Promise((ok) => server.close(ok)) };
}

// Messages of a request with a given role, as plain text.
export function textOf(message) {
	const c = message?.content;
	if (typeof c === "string") return c;
	return (c ?? []).map((p) => p.text ?? "").join("");
}

// Which config the smoke test runs on:
//   PI_EXTRAS_SMOKE_CONFIG=copy   a copy of the real config (PI_EXTRAS_SMOKE_SOURCE, default ~/.pi/agent)
//   PI_EXTRAS_SMOKE_CONFIG=empty  an empty config (what CI uses)
// Default: copy when the real config exists, empty otherwise.
export function configMode() {
	const mode = process.env.PI_EXTRAS_SMOKE_CONFIG;
	if (mode === "copy" || mode === "empty") return mode;
	return existsSync(sourceAgentDir()) ? "copy" : "empty";
}

function sourceAgentDir() {
	return process.env.PI_EXTRAS_SMOKE_SOURCE ?? join(homedir(), ".pi", "agent");
}

// Is a package source in settings this repository (any spelling of it)?
function isThisPackage(source, settingsDir) {
	const s = typeof source === "string" ? source : source?.source;
	if (!s) return false;
	if (/pi-extras|native-harness/.test(s)) return true;
	try {
		return resolve(settingsDir, s) === REPO;
	} catch {
		return false;
	}
}

// A throw-away agent dir. The real config is copied without sessions and backups; any install of
// this package in it is replaced by this checkout, and the mock provider is added to models.json.
// `extensions` filters this package's extensions like a settings entry does (e.g. ["-extensions/x/index.ts"]).
export function makeAgentDir({ mockUrl, mode = configMode(), extensions } = {}) {
	const dir = mkdtempSync(join(process.env.PI_EXTRAS_TMP ?? tmpdir(), "pi-extras-agent-"));
	chmodSync(dir, 0o700);
	if (mode === "copy") {
		const src = sourceAgentDir();
		cpSync(src, dir, {
			recursive: true,
			verbatimSymlinks: true,
			filter: (p) => {
				const rel = p.slice(src.length).replace(/^\/+/, "");
				const base = rel.split("/").pop();
				if (rel === "sessions" || rel.startsWith("sessions/")) return false;
				if (base.endsWith("~") || base.includes(".pre-")) return false; // editor and migration backups
				if (rel === "extensions/llama-native") return false; // the experiment, linked by its own scripts
				return true;
			},
		});
	}
	mkdirSync(join(dir, "sessions"), { recursive: true });
	const settingsPath = join(dir, "settings.json");
	const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
	settings.packages = (settings.packages ?? []).filter((p) => !isThisPackage(p, dir));
	settings.packages.push(extensions ? { source: REPO, extensions } : REPO);
	settings.extensions = (settings.extensions ?? []).filter((p) => !isThisPackage(p, dir));
	writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
	const modelsPath = join(dir, "models.json");
	const models = existsSync(modelsPath) ? JSON.parse(readFileSync(modelsPath, "utf8")) : {};
	models.providers ??= {};
	if (mockUrl) {
		models.providers[MOCK_PROVIDER] = {
			baseUrl: mockUrl,
			api: "openai-completions",
			apiKey: "none",
			models: [{ id: "mock", name: "pi-extras mock", reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 4096 }],
		};
	}
	writeFileSync(modelsPath, JSON.stringify(models, null, 2));
	return dir;
}

export function removeAgentDir(dir) {
	if (dir && dir.includes("pi-extras-agent-")) rmSync(dir, { recursive: true, force: true });
}

// The pi binary: PI_BIN, else the one pinned in devDependencies, else pi on PATH.
export function piBin() {
	if (process.env.PI_BIN) return process.env.PI_BIN;
	const local = join(REPO, "node_modules", ".bin", "pi");
	return existsSync(local) ? local : "pi";
}

// Run pi headless on an agent dir, in a scratch working directory. Terminal-integration variables
// (herdr, orca) are dropped so test runs never report themselves as the calling agent.
export function runPi(agentDir, args, { timeoutMs = 120_000, cwd } = {}) {
	const work = cwd ?? mkdtempSync(join(process.env.PI_EXTRAS_TMP ?? tmpdir(), "pi-extras-work-"));
	const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
	for (const k of Object.keys(env)) if (/^(HERDR|ORCA)_/.test(k)) delete env[k];
	const extra = process.env.PI_EXTRAS_SMOKE_MCP === "1" ? [] : ["--no-mcp"];
	return new Promise((ok) => {
		const child = spawn(piBin(), ["--offline", "--no-session", ...extra, ...args], { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "", stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			if (!cwd) rmSync(work, { recursive: true, force: true });
			ok({ code, signal, stdout, stderr });
		});
	});
}

// Extension folders of this package: extensions/<name>/ plus the experimental ones.
export function extensionDirs() {
	const out = [];
	const ext = join(REPO, "extensions");
	if (existsSync(ext))
		for (const d of readdirSync(ext, { withFileTypes: true }))
			if (d.isDirectory() && existsSync(join(ext, d.name, "index.ts"))) out.push(join(ext, d.name));
	out.push(join(REPO, "experimental", "llama-native", "extension"));
	return out;
}
