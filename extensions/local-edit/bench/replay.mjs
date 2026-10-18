#!/usr/bin/env node
// Offline replay of real edit calls from pi sessions: what would local-edit have done with them?
//
//   node extensions/local-edit/bench/replay.mjs [--json out.json] [--show] [session dirs...]
//
// Default sources: ~/.pi/agent/sessions and the bench sessions of the other pi-extras experiments
// under ~/.cache/pi-extras/*/sessions (not local-edit's own, whose edits already went through it).
// Sessions stay where they are; only counts (and, with --show, the cases) are printed.
//
// For every edit call the file's content at that moment is reconstructed from the session itself:
// a full `read` result (no offset/limit, not truncated), a `cat FILE` bash result, a `write` call,
// then each successful edit applied on top. A bash command that names the file makes it unknown
// again. Calls whose file content is unknown are counted but not replayed.
//
// Replayed calls go through pi's own edit tool (in memory) and through local-edit's matcher:
//   - a failed call where pi's tool also fails on the reconstruction: did local-edit place it
//     (and how), or what did it answer instead;
//   - a failed call where pi's tool succeeds on the reconstruction: the reconstruction is stale,
//     the call is left out ("unreliable");
//   - a successful call: local-edit must leave it exactly as pi did (same resulting file).
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { repairArguments } from "../index.ts";
import { EditMatchError, resolveEdits } from "../match.ts";
import { resolveEditPath } from "../paths.ts";

const argv = process.argv.slice(2);
const show = argv.includes("--show");
const jsonOut = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : undefined;
const dirs = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--json");
const HOME = homedir();
if (!dirs.length) {
	dirs.push(join(HOME, ".pi/agent/sessions"));
	const cache = join(HOME, ".cache/pi-extras");
	if (existsSync(cache)) for (const d of readdirSync(cache)) if (d !== "local-edit" && existsSync(join(cache, d, "sessions"))) dirs.push(join(cache, d, "sessions"));
}

function files(dir) {
	const out = [];
	const walk = (d) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith(".jsonl")) out.push(p);
		}
	};
	if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir);
	return out;
}

const LOCAL = /^(llama\.cpp|llama-native|ollama|lmstudio|vllm)$/;
const base = createEditToolDefinition(process.cwd());
const prep = (a) => repairArguments(a, base.prepareArguments);

/** pi's edit tool on an in-memory file: { ok, content | error } */
async function piEdit(content, args) {
	let written;
	const def = createEditToolDefinition("/", {
		operations: { readFile: async () => Buffer.from(content), writeFile: async (_p, c) => void (written = c), access: async () => {} },
	});
	try {
		await def.execute("r", { ...args, path: "/replay" }, undefined, undefined, { cwd: "/" });
		return { ok: true, content: written };
	} catch (e) {
		return { ok: false, error: String(e?.message ?? e) };
	}
}

const textOf = (m) => (m.content ?? []).map((c) => (typeof c === "string" ? c : c.text ?? "")).join("");

const stats = { local: newStats(), cloud: newStats() };
function newStats() {
	return {
		sessions: 0, edits: 0, failed: 0, failedKnown: 0, unreliable: 0,
		recovered: 0, recoveredHow: {}, stillFailing: 0, stillHow: {},
		pathFailed: 0, pathRecovered: 0,
		okKnown: 0, okSame: 0, okDifferent: 0, cases: [],
	};
}
const errKind = (t) => /could not find/i.test(t) ? "not_found" : /occurrences/i.test(t) ? "ambiguous" : /ENOENT|Could not edit file/i.test(t) ? "path" : /validat/i.test(t) ? "arguments" : /no changes/i.test(t) ? "no_change" : "other";

for (const dir of dirs) {
	for (const f of files(dir)) {
		let cwd = "/";
		const known = new Map(); // abs path -> content (LF)
		const calls = new Map();
		let provider;
		let counted = new Set();
		const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
		for (const line of lines) {
			let d;
			try {
				d = JSON.parse(line);
			} catch {
				continue;
			}
			if (d.type === "session" && d.cwd) cwd = d.cwd;
			const m = d.message;
			if (!m) continue;
			if (m.role === "assistant") {
				provider = m.provider;
				for (const c of m.content ?? []) if (c?.type === "toolCall") calls.set(c.id, { ...c, provider });
				continue;
			}
			if (m.role !== "toolResult") continue;
			const call = calls.get(m.toolCallId);
			if (!call) continue;
			const kind = LOCAL.test(call.provider ?? "") ? "local" : "cloud";
			const S = stats[kind];
			if (!counted.has(kind)) {
				counted.add(kind);
				S.sessions++;
			}
			const args = call.arguments ?? {};
			const abs = (p) => (typeof p === "string" ? (isAbsolute(p) ? p : resolve(cwd, p.replace(/^@/, ""))) : undefined);
			const text = textOf(m);
			if (m.toolName === "read") {
				const p = abs(args.path);
				if (!p) continue;
				if (!m.isError && args.offset == null && args.limit == null && !m.details?.truncation && !/\n\n\[(Showing lines|\d+ more lines)/.test(text)) known.set(p, text.replace(/\r\n?/g, "\n"));
				continue;
			}
			if (m.toolName === "write") {
				if (!m.isError && typeof args.content === "string") known.set(abs(args.path), args.content.replace(/\r\n?/g, "\n"));
				continue;
			}
			if (m.toolName === "bash") {
				const cmd = String(args.command ?? "");
				const cat = /^\s*cat\s+(['"]?)([^\s'"|;&<>]+)\1\s*$/.exec(cmd);
				if (cat && !m.isError) {
					known.set(abs(cat[2]), text.replace(/\r\n?/g, "\n"));
					continue;
				}
				for (const p of [...known.keys()]) if (cmd.includes(basename(p))) known.delete(p);
				continue;
			}
			if (m.toolName !== "edit") continue;
			S.edits++;
			const a = prep(args);
			const p = abs(a?.path);
			const content = p ? known.get(p) : undefined;
			if (m.isError) {
				S.failed++;
				const ek = errKind(text);
				if (ek === "path") {
					S.pathFailed++;
					const r = existsSync(cwd) ? resolveEditPath(a.path, cwd) : { path: a.path };
					if (r.note) {
						S.pathRecovered++;
						S.cases.push({ kind: "path", file: f, provider: call.provider, from: a.path, note: r.note });
					}
					continue;
				}
				if (content === undefined || !Array.isArray(a.edits)) continue;
				S.failedKnown++;
				const pi = await piEdit(content, a);
				if (pi.ok) {
					S.unreliable++;
					continue;
				}
				try {
					const r = resolveEdits(content, a.edits, a.path);
					const after = await piEdit(content, { ...a, edits: r.edits });
					if (!after.ok) throw new EditMatchError(after.error);
					S.recovered++;
					for (const n of r.notes) {
						const how = /indentation/.test(n) ? "indentation" : /similar/.test(n) ? "similarity" : /literal/.test(n) ? "escapes" : "other";
						S.recoveredHow[how] = (S.recoveredHow[how] ?? 0) + 1;
					}
					S.cases.push({ kind: "recovered", file: f, provider: call.provider, error: text.slice(0, 200), notes: r.notes, edits: a.edits, placed: r.edits });
					known.set(p, after.content.replace(/\r\n?/g, "\n"));
				} catch (e) {
					S.stillFailing++;
					const msg = String(e.message);
					const how = /several places|matches \d+ places/.test(msg) ? "ambiguous (lines listed)" : /Closest text/.test(msg) ? "not found (candidates shown)" : /No similar lines/.test(msg) ? "not found (nothing similar)" : "other";
					S.stillHow[how] = (S.stillHow[how] ?? 0) + 1;
					S.cases.push({ kind: "still", file: f, provider: call.provider, error: text.slice(0, 200), answer: msg.slice(0, 1200), edits: a.edits });
				}
				continue;
			}
			// a successful edit: local-edit must not change its outcome
			if (content === undefined || !Array.isArray(a.edits)) {
				if (p) known.delete(p);
				continue;
			}
			const pi = await piEdit(content, a);
			if (!pi.ok) {
				known.delete(p); // stale reconstruction
				continue;
			}
			S.okKnown++;
			try {
				const r = resolveEdits(content, a.edits, a.path);
				const mine = await piEdit(content, { ...a, edits: r.edits });
				if (mine.ok && mine.content === pi.content) S.okSame++;
				else {
					S.okDifferent++;
					S.cases.push({ kind: "changed-success", file: f, provider: call.provider, edits: a.edits, notes: r.notes });
				}
			} catch (e) {
				S.okDifferent++;
				S.cases.push({ kind: "broke-success", file: f, provider: call.provider, edits: a.edits, error: String(e.message).slice(0, 400) });
			}
			known.set(p, pi.content.replace(/\r\n?/g, "\n"));
		}
	}
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "–");
for (const [k, S] of Object.entries(stats)) {
	console.log(`\n== ${k}: ${S.sessions} sessions, ${S.edits} edit calls, ${S.failed} failed (${pct(S.failed, S.edits)})`);
	console.log(`  failed, file content known: ${S.failedKnown} (${S.unreliable} unreliable reconstructions left out)`);
	console.log(`    placed by local-edit: ${S.recovered} ${JSON.stringify(S.recoveredHow)}`);
	console.log(`    still refused: ${S.stillFailing} ${JSON.stringify(S.stillHow)}`);
	console.log(`  failed on the path: ${S.pathFailed}, resolved by local-edit: ${S.pathRecovered}`);
	console.log(`  successful, content known: ${S.okKnown}; same result with local-edit: ${S.okSame}, different: ${S.okDifferent}`);
	const rate = S.failed - S.recovered - S.pathRecovered;
	console.log(`  edit error rate: ${pct(S.failed, S.edits)} -> ${pct(rate, S.edits)} (replayed failures only; unknown-content failures counted as still failing)`);
	if (show)
		for (const c of S.cases) {
			console.log(`\n--- ${c.kind} [${c.provider}] ${c.file.replace(HOME, "~")}`);
			console.log(JSON.stringify(c, (key, v) => (key === "file" ? undefined : v), 1).slice(0, 3000));
		}
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(Object.fromEntries(Object.entries(stats).map(([k, S]) => [k, { ...S, cases: undefined }])), null, 1));
