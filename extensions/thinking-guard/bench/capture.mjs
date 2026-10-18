#!/usr/bin/env node
// Capture the exact chat request pi sends to continue a session at a given entry: the session is
// cut just before entry LINE (an assistant reply), opened with pi's SDK, and the next request's
// payload is written to OUT instead of being sent. bench/replay.py replays it with and without
// the thinking budget.
//
// usage: capture.mjs SESSION.jsonl LINE PROVIDER/MODEL OUT.json   (PI_CODING_AGENT_DIR: config to use)
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [file, line, modelRef, out] = process.argv.slice(2);
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME, ".pi", "agent");
const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
const cut = lines.slice(0, Number(line));
const dir = mkdtempSync(join(tmpdir(), "tg-capture-"));
const sessionFile = join(dir, "session.jsonl");
writeFileSync(sessionFile, cut.join("\n") + "\n");
const header = JSON.parse(cut[0]);
const cwd = header.cwd ?? process.cwd();

let captured = false;
const resourceLoader = new DefaultResourceLoader({
	cwd,
	agentDir,
	noContextFiles: false,
	extensionFactories: [
		(pi) => {
			pi.on("before_provider_request", (event) => {
				if (!captured) writeFileSync(out, JSON.stringify(event.payload));
				captured = true;
				// send it to a model the server does not have: it fails at once, nothing is computed
				return { ...event.payload, model: "thinking-guard-capture-no-such-model" };
			});
		},
	],
});
await resourceLoader.reload();
const sessionManager = SessionManager.open(sessionFile, dir, cwd);
const { session } = await createAgentSession({ cwd, agentDir, resourceLoader, sessionManager });
const [provider, id] = modelRef.split("/");
const model = session.modelRegistry?.find?.(provider, id) ?? session.modelRuntime?.getModel?.(provider, id);
if (model) await session.setModel(model);
session.setThinkingLevel?.("low");
const run = session.agent.continue().catch(() => {});
const t0 = Date.now();
while (!captured && Date.now() - t0 < 60_000) await new Promise((ok) => setTimeout(ok, 50));
await session.abort();
await run;
console.log(captured ? `captured ${out}` : "no request captured");
process.exit(captured ? 0 : 1);
