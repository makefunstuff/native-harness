import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const { readArgs } = createRequire(import.meta.url)("./args.cjs");

test("readArgs: one flag per line, comments, ${VAR} expansion", () => {
	const f = join(mkdtempSync(join(tmpdir(), "llama-native-args-")), "a.args");
	writeFileSync(f, "# comment\n\n--model ${MODEL_DIR}/m.gguf\n--flash-attn\n  --ctx-size   4096  \n--x ${UNSET_VAR_FOR_TEST}\n");
	assert.deepEqual(readArgs(f, { MODEL_DIR: "/models" }), ["--model", "/models/m.gguf", "--flash-attn", "--ctx-size", "4096", "--x", ""]);
});

test("readArgs parses the shipped preset", () => {
	const args = readArgs(join(import.meta.dirname, "../configs/qwen3.8-27b.args"), { MODEL_DIR: "/m" });
	assert.ok(args.includes("--ctx-size") || args.includes("-c"), "has a context size");
	assert.ok(args.some((a: string) => a.startsWith("/m/")), "model path expanded");
});
