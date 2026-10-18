import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakePi } from "../../../test/lib/fake-pi.ts";
import extension from "./index.ts";

const tmp = mkdtempSync(join(tmpdir(), "llama-native-test-"));

test("without the built addon the extension registers nothing", async () => {
	process.env.LLAMA_NATIVE_ADDON = join(tmp, "missing.node");
	const pi = fakePi();
	await extension(pi as any);
	assert.equal(pi.providers.size, 0);
	assert.equal(pi.handlers.size, 0);
});

test("with an addon file it registers the provider, mirroring the llama.cpp model entry", async () => {
	// the addon is only opened on the first request, so an empty file is enough here
	process.env.LLAMA_NATIVE_ADDON = join(tmp, "llama_native.node");
	writeFileSync(process.env.LLAMA_NATIVE_ADDON, "");
	process.env.PI_CODING_AGENT_DIR = tmp;
	writeFileSync(join(tmp, "models.json"), JSON.stringify({ providers: { "llama.cpp": { models: [{ id: "qwen3.8-27b", name: "Qwen", contextWindow: 4096 }] } } }));
	const pi = fakePi();
	await extension(pi as any);
	const p = pi.providers.get("llama-native");
	assert.ok(p, "provider registered");
	assert.equal(p.models[0].id, "qwen3.8-27b");
	assert.equal(p.models[0].name, "Qwen (in-process)");
	assert.equal(p.models[0].contextWindow, 4096);
	assert.equal(typeof p.streamSimple, "function");
});
