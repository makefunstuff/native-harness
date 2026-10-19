import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fakeCtx, fakePi } from "../../test/lib/fake-pi.ts";
import { lessons, readConfig, repoKey } from "./index.ts";
import { judge } from "./judge.ts";
import { makeNote } from "./note.ts";
import { CONTRADICTED, FileStore, HindsightStore, Library } from "./store.ts";

const tmp = mkdtempSync(join(tmpdir(), "lessons-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const dir = () => join(tmp, `d${n++}`);

// A stand-in for Hindsight's retain / recall / delete endpoints, keeping documents in memory.
async function fakeHindsight(opts: { failRecall?: boolean; failRetain?: boolean } = {}) {
	const docs = new Map<string, any>();
	let deleteFails = false;
	const seen: any[] = [];
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const c of req) body += c;
		const payload = body ? JSON.parse(body) : undefined;
		seen.push({ method: req.method, url: req.url, payload, auth: req.headers.authorization });
		const reply = (code: number, data: unknown) => {
			res.writeHead(code, { "content-type": "application/json" });
			res.end(JSON.stringify(data));
		};
		if (req.method === "POST" && req.url!.endsWith("/memories")) {
			if (opts.failRetain) return reply(500, { detail: "could not resize shared memory segment" });
			for (const it of payload.items) docs.set(it.document_id, it);
			return reply(200, { success: true });
		}
		if (req.method === "POST" && req.url!.endsWith("/memories/recall")) {
			if (opts.failRecall) return reply(503, { detail: "embeddings unavailable" });
			const want: string[] = payload.tags;
			const results = [...docs.values()]
				.filter((d) => want.every((t) => d.tags.includes(t)))
				.map((d, i) => ({ text: d.content, document_id: d.document_id, metadata: d.metadata, tags: d.tags, scores: { final: 0.9 - i * 0.1 } }));
			// one document comes back as two facts, as Hindsight does
			return reply(200, { results: results.flatMap((r) => [r, { ...r, scores: { final: r.scores.final / 10 } }]) });
		}
		const del = /\/documents\/([^/]+)$/.exec(req.url!);
		if (req.method === "DELETE" && del && deleteFails) return reply(500, { detail: "delete failed" });
		if (req.method === "DELETE" && del) {
			docs.delete(decodeURIComponent(del[1]));
			return reply(200, {});
		}
		reply(404, {});
	});
	await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
	const url = `http://127.0.0.1:${(server.address() as any).port}`;
	return { url, docs, seen, failDelete: (v: boolean) => void (deleteFails = v), close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

test("Library (files only): add, merge duplicates, cap, contradict until dropped, forget", async () => {
	const lib = new Library(new FileStore(dir()), undefined, { maxNotes: 2, ttlDays: 180, dropBelow: 0.3, dedupe: 0.6 });
	const a = await lib.save(makeNote("r", { cue: "new operation module", lesson: "register it in src/registry.ts", confidence: 0.6 }));
	assert.equal(a.action, "added");
	const b = await lib.save(makeNote("r", { cue: "adding an operation module", lesson: "register the functions in src/registry.ts", confidence: 0.6 }));
	assert.equal(b.action, "merged");
	assert.equal(lib.files.list("r").length, 1);
	await lib.save(makeNote("r", { cue: "dates", lesson: "use UTC getters", confidence: 0.9 }));
	const c = await lib.save(makeNote("r", { cue: "error codes", lesson: "throw LedgerError", confidence: 0.2 }));
	assert.equal(lib.files.list("r").length, 2, "capped at 2");
	assert.deepEqual(c.evicted.length, 0, "the new note itself was the one cut, nothing else");
	const rec = await lib.recall("r", "add an operation module for VAT", 5);
	assert.equal(rec.source, "file");
	assert.equal(rec.candidates[0].note.id, a.note.id);
	assert.equal(await lib.adjust("r", rec.candidates[0].note, -0.4), "updated"); // 0.7 → 0.3
	assert.equal(await lib.adjust("r", lib.files.list("r").find((x) => x.id === a.note.id)!, -0.4), "dropped");
	assert.equal(lib.files.list("r").length, 1);
	assert.ok(await lib.forget("r", lib.files.list("r")[0].id));
	assert.equal(lib.files.list("r").length, 0);
});

test("Library keeps different lessons learnt for the same or a similar cue", async () => {
	const lib = new Library(new FileStore(dir()), undefined);
	const a = await lib.save(makeNote("r", { cue: "adding a new operation module", lesson: "give it its own tests/ops/<name>.spec.ts file" }));
	const b = await lib.save(makeNote("r", { cue: "adding a new operation module", lesson: "add a ## section for it to docs/operations.md" }));
	const c = await lib.save(makeNote("r", { cue: "adding a new operation under src/ops", lesson: "list every new error code in src/codes.ts" }));
	const d = await lib.save(makeNote("r", { cue: "adding an operation in src/ops", lesson: "give the operation its own test file" }));
	assert.deepEqual([a.action, b.action, c.action, d.action], ["added", "added", "added", "added"]);
	assert.equal(lib.files.list("r").length, 4);
	const again = await lib.save(makeNote("r", { cue: "adding an operation module", lesson: "give it its own tests/ops/<name>.spec.ts" }));
	assert.equal(again.action, "merged", "the same lesson written again is merged");
	assert.equal(again.note.id, a.note.id);
	assert.equal(lib.files.list("r").length, 4);
});

test("a note at the default confidence survives one contradiction and goes after the second", async () => {
	const lib = new Library(new FileStore(dir()), undefined);
	const s = await lib.save(makeNote("r", { cue: "c", lesson: "l" })); // no confidence given: 0.6
	assert.equal(await lib.adjust("r", s.note, CONTRADICTED), "updated");
	assert.equal(await lib.adjust("r", lib.files.list("r")[0], CONTRADICTED), "dropped");
	const hi = await lib.save(makeNote("r", { cue: "c2", lesson: "l2", confidence: 0.9 }));
	assert.equal(await lib.adjust("r", hi.note, CONTRADICTED), "updated");
	assert.equal(await lib.adjust("r", lib.files.list("r")[0], CONTRADICTED), "updated");
	assert.equal(await lib.adjust("r", lib.files.list("r")[0], CONTRADICTED), "dropped");
});

test("a note deleted here does not come back from Hindsight when the delete failed; the delete is retried", async () => {
	const h = await fakeHindsight();
	try {
		const lib = new Library(new FileStore(dir()), new HindsightStore({ url: h.url, bank: "b", timeoutMs: 5000 }));
		const s = await lib.save(makeNote("r", { cue: "rounding money amounts", lesson: "use roundHalfEven" }));
		h.failDelete(true);
		assert.ok(await lib.forget("r", s.note.id));
		assert.ok(h.docs.has(s.note.id), "Hindsight still has it");
		assert.match(lib.errors.at(-1)!, /Hindsight delete failed/);
		const rec = await lib.recall("r", "rounding money amounts", 5);
		assert.equal(rec.candidates.length, 0, "the tombstone hides it");
		h.failDelete(false);
		await lib.recall("r", "anything", 5);
		assert.ok(!h.docs.has(s.note.id), "the delete was retried");
		assert.equal(lib.files.removed("r")[s.note.id].pending, false);
	} finally {
		await h.close();
	}
});

test("a dropped lesson learnt again is live again: recalled from Hindsight, and the pending delete does not remove it", async () => {
	const h = await fakeHindsight();
	try {
		const lib = new Library(new FileStore(dir()), new HindsightStore({ url: h.url, bank: "b", timeoutMs: 5000 }));
		const f = { cue: "rounding money amounts", lesson: "use roundHalfEven" };
		const s = await lib.save(makeNote("r", f));
		h.failDelete(true);
		await lib.adjust("r", s.note, CONTRADICTED);
		assert.equal(await lib.adjust("r", lib.files.list("r")[0], CONTRADICTED), "dropped");
		assert.equal(lib.files.removed("r")[s.note.id].pending, true);
		h.failDelete(false);
		const again = await lib.save(makeNote("r", f));
		assert.equal(again.note.id, s.note.id);
		assert.equal(lib.files.removed("r")[s.note.id], undefined, "the tombstone is cleared");
		const rec = await lib.recall("r", "rounding money amounts", 5);
		assert.deepEqual(rec.candidates.map((c) => [c.note.id, c.source]), [[s.note.id, "hindsight"]]);
		assert.equal(rec.hindsightHits, 1);
		assert.ok(h.docs.has(s.note.id), "Hindsight keeps the new copy");
	} finally {
		await h.close();
	}
});

test("recall says how many candidates came from Hindsight, not only that Hindsight answered", async () => {
	const h = await fakeHindsight({ failRetain: true }); // writes fail: Hindsight stays empty
	try {
		const lib = new Library(new FileStore(dir()), new HindsightStore({ url: h.url, bank: "b", timeoutMs: 5000 }));
		await lib.save(makeNote("r", { cue: "rounding money amounts", lesson: "use roundHalfEven" }));
		const rec = await lib.recall("r", "rounding money amounts", 5);
		assert.equal(rec.source, "hindsight");
		assert.equal(rec.hindsightHits, 0);
		assert.deepEqual(rec.candidates.map((c) => c.source), ["file"]);
	} finally {
		await h.close();
	}
});

test("Library drops notes past their time to live", async () => {
	const files = new FileStore(dir());
	const old = { ...makeNote("r", { cue: "old thing", lesson: "x" }), updated: "2020-01-01T00:00:00.000Z" };
	files.write("r", [old, makeNote("r", { cue: "old thing again", lesson: "y" })]);
	const lib = new Library(files, undefined, { maxNotes: 40, ttlDays: 30, dropBelow: 0.3, dedupe: 0.6 });
	const rec = await lib.recall("r", "old thing", 5);
	assert.equal(rec.candidates.length, 1);
	assert.equal(files.list("r").length, 1);
});

test("HindsightStore: one tagged document per lesson, recall dedupes facts by document, delete", async () => {
	const h = await fakeHindsight();
	try {
		const hs = new HindsightStore({ url: h.url, bank: "b", key: "k", timeoutMs: 5000 });
		const lib = new Library(new FileStore(dir()), hs);
		const s = await lib.save(makeNote("repo/x", { cue: "rounding amounts", lesson: "use roundHalfEven" }));
		await lib.save(makeNote("other", { cue: "rounding amounts", lesson: "something else" }));
		assert.equal(h.docs.size, 2);
		const doc = h.docs.get(s.note.id);
		assert.deepEqual(doc.tags, ["pi-lessons", "repo:repo/x"]);
		assert.equal(doc.update_mode, "replace");
		assert.equal(doc.metadata.cue, "rounding amounts");
		assert.equal(h.seen[0].auth, "Bearer k");
		assert.match(h.seen[0].url, /\/v1\/default\/banks\/b\/memories$/);
		const rec = await lib.recall("repo/x", "rounding", 5);
		assert.equal(rec.source, "hindsight");
		assert.equal(rec.candidates.length, 1, "two facts of one document, other repo filtered");
		assert.equal(rec.candidates[0].note.lesson, "use roundHalfEven");
		assert.equal(await lib.adjust("repo/x", rec.candidates[0].note, -0.5), "dropped");
		assert.ok(!h.docs.has(s.note.id), "contradicted lesson deleted in Hindsight too");
	} finally {
		await h.close();
	}
});

test("Library falls back to the local copy and says why when Hindsight recall fails", async () => {
	const h = await fakeHindsight({ failRecall: true });
	try {
		const lib = new Library(new FileStore(dir()), new HindsightStore({ url: h.url, bank: "b", timeoutMs: 5000 }));
		await lib.save(makeNote("r", { cue: "rounding money amounts", lesson: "use roundHalfEven" }));
		const rec = await lib.recall("r", "a VAT amount rounded to cents", 5);
		assert.equal(rec.source, "file");
		assert.match(rec.fallback!, /Hindsight recall failed \(Hindsight answered 503.*plain-text/);
		assert.equal(rec.candidates.length, 1);
	} finally {
		await h.close();
	}
	// unreachable server: writes fail soft, the lesson stays local
	const lib = new Library(new FileStore(dir()), new HindsightStore({ url: "http://127.0.0.1:9", bank: "b", timeoutMs: 2000 }));
	await lib.save(makeNote("r", { cue: "c", lesson: "l" }));
	assert.equal(lib.files.list("r").length, 1);
	assert.match(lib.errors[0], /Hindsight write failed/);
});

test("a failed Hindsight write: the note still comes back (local copy) and is sent again once Hindsight works", async () => {
	const opts = { failRetain: true };
	const h = await fakeHindsight(opts);
	try {
		const lib = new Library(new FileStore(dir()), new HindsightStore({ url: h.url, bank: "b", timeoutMs: 5000 }));
		const s = await lib.save(makeNote("r", { cue: "rounding money amounts", lesson: "use roundHalfEven" }));
		assert.match(lib.errors[0], /Hindsight write failed \(Hindsight answered 500.*sent again later/);
		assert.equal(lib.files.list("r")[0].synced, false);
		const rec = await lib.recall("r", "a VAT amount rounded to cents", 5);
		assert.equal(rec.source, "hindsight");
		assert.equal(rec.fallback, undefined);
		assert.deepEqual(rec.candidates.map((c) => [c.note.id, c.source]), [[s.note.id, "file"]]);
		opts.failRetain = false;
		await lib.recall("r", "anything", 5);
		assert.ok(h.docs.has(s.note.id), "sent on the next recall");
		assert.equal(lib.files.list("r")[0].synced, true);
	} finally {
		await h.close();
	}
});

test("judge: classifier keeps lessons by probability; failure falls back to the threshold", async () => {
	const cands = [
		{ note: makeNote("r", { cue: "a", lesson: "x" }), score: 0.9, source: "hindsight" as const },
		{ note: makeNote("r", { cue: "b", lesson: "y" }), score: 0.2, source: "hindsight" as const },
	];
	let asked: any;
	const registry = {
		classify: async (_m: any, ctx: any) => {
			asked = ctx;
			return { stopReason: "stop", answers: { l0: { type: "bool", probability: 0.1 }, l1: { type: "bool", probability: 0.8 } } };
		},
	};
	const opts = { k: 3, minP: 0.5, minHindsight: 0.3, minText: 0.35 };
	const j = await judge("task", cands, { ...opts, registry, model: {}, modelName: "jev-lan/jev" });
	assert.deepEqual(j.kept.map((c) => c.note.cue), ["b"]);
	assert.equal(j.judge, "jev-lan/jev");
	assert.equal(Object.keys(asked.questions).length, 2);
	assert.equal(asked.questions.l0.type, "bool");
	const broken = { classify: async () => ({ stopReason: "error", errorMessage: "gateway down" }) };
	const f = await judge("task", cands, { ...opts, registry: broken, model: {}, modelName: "jev-lan/jev" });
	assert.equal(f.judge, "threshold");
	assert.match(f.fallback!, /jev-lan\/jev failed \(gateway down\)/);
	assert.deepEqual(f.kept.map((c) => c.note.cue), ["a"]);
	assert.deepEqual((await judge("task", cands, opts)).kept.map((c) => c.note.cue), ["a"]);
});

test("repoKey: origin remote without credentials, else package.json name, else folder", () => {
	const d = dir();
	mkdirSync(d, { recursive: true });
	writeFileSync(join(d, "package.json"), JSON.stringify({ name: "ledger" }));
	assert.equal(repoKey(d), "ledger");
	execFileSync("git", ["init", "-q", d]);
	execFileSync("git", ["-C", d, "remote", "add", "origin", "https://user:tok@GitHub.com/Acme/Ledger.git"]);
	assert.equal(repoKey(d), "github.com/acme/ledger");
	execFileSync("git", ["-C", d, "remote", "set-url", "origin", "git@github.com:acme/ledger.git"]);
	assert.equal(repoKey(d), "github.com/acme/ledger");
});

test("readConfig defaults and switches", () => {
	const c = readConfig({ PI_CODING_AGENT_DIR: "/x/agent" });
	assert.equal(c.enabled, true);
	assert.equal(c.dir, "/x/agent/lessons");
	assert.equal(c.hindsight.bank, "omp-shared");
	assert.equal(c.k, 3);
	assert.equal(readConfig({ LESSONS: "off" }).enabled, false);
	assert.equal(readConfig({ LESSONS_STORE: "file", HINDSIGHT_BANK: "a", LESSONS_HINDSIGHT_BANK: "b" }).hindsight.bank, "b");
});

// The whole loop through the extension's handlers: a failure fixed in session 1 makes it ask for a
// lesson; the answer is stored; session 2 on a matching task gets it appended after the prompt.
test("extension: fixed failure → lesson request → stored → shown in the next session; contradiction drops it", async () => {
	const d = dir();
	const config = { ...readConfig({}), dir: d, store: "file" as const, judge: "off", repo: "ledger" };
	const pi = fakePi();
	lessons(pi as any, config);
	const ctx = fakeCtx({ cwd: tmp, modelRegistry: { findOfType: () => undefined } });
	await pi.emit("session_start", { reason: "startup" }, ctx);
	const start = await pi.emit("before_agent_start", { messageType: "user", prompt: "Add a VAT operation", systemPromptOptions: {} }, ctx);
	assert.deepEqual(start, [undefined], "nothing stored yet, nothing added");
	const bash = (command: string, ok: boolean, text: string) =>
		pi.emit("tool_result", { toolName: "bash", input: { command }, content: [{ type: "text", text }], isError: !ok, structuredContent: { exit_code: ok ? 0 : 1 } }, ctx);
	await bash("npm test", false, "not ok 3 - registry\nAssertionError: src/ops/vat.ts exports vatFor but src/registry.ts does not list it");
	await bash("npm test", true, "ok");
	const [settle] = await pi.emit("agent_before_settle", { outcome: "completed", continue: false, entries: [] }, ctx);
	assert.equal(settle.continue, true);
	assert.match(settle.entries[0].content, /npm test` failed \(.*registry/);
	const [again] = await pi.emit("agent_before_settle", { outcome: "completed", continue: false, entries: [] }, ctx);
	assert.equal(again, undefined, "asked once per prompt");
	const answer = "```lesson\ncue: adding an operation module (VAT, tax, discount) under src/ops\nlesson: list its exported functions in src/registry.ts\nevidence: conventions test failed until registered\nconfidence: 0.8\n```";
	await pi.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: answer }] } }, ctx);
	assert.equal(new FileStore(d).list("ledger").length, 1);
	assert.match(ctx.notes.at(-1).message, /lessons: added "adding an operation module/);

	await pi.emit("session_start", { reason: "new" }, ctx);
	const [res] = await pi.emit("before_agent_start", { messageType: "user", prompt: "Add a discount operation under src/ops", systemPromptOptions: {} }, ctx);
	assert.equal(res.message.customType, "lessons");
	assert.match(res.message.content, /L1\. When adding an operation module.*src\/registry\.ts/);
	const [none] = await pi.emit("before_agent_start", { messageType: "user", prompt: "and another", systemPromptOptions: {} }, ctx);
	assert.equal(none, undefined, "recalled once per session");
	await bash("npm test", false, "not ok 1");
	await bash("npm test", true, "ok");
	const [ask2] = await pi.emit("agent_before_settle", { outcome: "completed", continue: false, entries: [] }, ctx);
	assert.match(ask2.entries[0].content, /Lessons L1 were shown/);
	await pi.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "no lesson\ncontradicts: L1" }] } }, ctx);
	assert.equal(new FileStore(d).list("ledger")[0].confidence.toFixed(1), "0.5");
	await pi.emit("session_start", { reason: "new" }, ctx);
	await pi.emit("before_agent_start", { messageType: "user", prompt: "Add a refund operation under src/ops", systemPromptOptions: {} }, ctx);
	await bash("npm test", false, "x");
	await bash("npm test", true, "ok");
	await pi.emit("agent_before_settle", { outcome: "completed", continue: false, entries: [] }, ctx);
	await pi.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "contradicts: L1" }] } }, ctx);
	assert.equal(new FileStore(d).list("ledger").length, 0, "contradicted twice: expired");
});

test("extension: an aborted run, or one another extension continues, gets no request", async () => {
	const pi = fakePi();
	lessons(pi as any, { ...readConfig({}), dir: dir(), store: "file", judge: "off", repo: "r" });
	const ctx = fakeCtx({ modelRegistry: { findOfType: () => undefined } });
	await pi.emit("session_start", {}, ctx);
	await pi.emit("before_agent_start", { messageType: "user", prompt: "x" }, ctx);
	await pi.emit("tool_result", { toolName: "bash", input: { command: "npm test" }, content: [], isError: true }, ctx);
	await pi.emit("tool_result", { toolName: "bash", input: { command: "npm test" }, content: [], isError: false }, ctx);
	assert.deepEqual(await pi.emit("agent_before_settle", { outcome: "aborted", continue: false, entries: [] }, ctx), [undefined]);
	assert.deepEqual(await pi.emit("agent_before_settle", { outcome: "completed", continue: true, entries: [] }, ctx), [undefined]);
	assert.equal((await pi.emit("agent_before_settle", { outcome: "completed", continue: false, entries: [] }, ctx))[0].continue, true);
});

test("extension: LESSONS=off registers nothing", () => {
	const pi = fakePi();
	lessons(pi as any, readConfig({ LESSONS: "off" }));
	assert.equal(pi.handlers.size, 0);
	assert.equal(pi.commands.size, 0);
});
