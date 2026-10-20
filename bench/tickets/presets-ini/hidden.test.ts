import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPresets, main } from "./src/presets.ts";

const write = (text: string) => {
	const p = join(mkdtempSync(join(tmpdir(), "presets-")), "p.ini");
	writeFileSync(p, text);
	return p;
};

test("defaults are inherited and overridden", () => {
	assert.deepEqual(loadPresets(write("a = 1\nb = 2\n[x]\nb = 3\n[y]\n")), { x: { a: "1", b: "3" }, y: { a: "1", b: "2" } });
});

test("values keep '=' and lose surrounding spaces", () => {
	assert.equal(loadPresets(write("[x]\n  args   =  --foo=bar baz=1  \n")).x.args, "--foo=bar baz=1");
});

test("comments and blank lines; '#' inside a value is not a comment", () => {
	assert.equal(loadPresets(write("# c\n; c\n   # indented\n\n[x]\nk = v # not a comment\n")).x.k, "v # not a comment");
});

test("a duplicate section names its line", () => {
	assert.throws(() => loadPresets(write("[x]\nk=1\n\n[x]\n")), /\b4\b/);
});

test("a bad line names its line", () => {
	assert.throws(() => loadPresets(write("[x]\nk=1\njunk line\n")), /\b3\b/);
});

test("file order", () => {
	assert.deepEqual(Object.keys(loadPresets(write("[b]\n[a]\n[c]\n"))), ["b", "a", "c"]);
});

test("report", () => {
	const lines: string[] = [];
	const path = write("[q]\nctx-size = 4096\ndevice = CUDA1\nspec-draft-model = /d.gguf\n[z]\nsplit-mode = tensor\n");
	assert.equal(main([path], (l) => void lines.push(l)), 0);
	assert.deepEqual(lines, ["q ctx=4096 devices=CUDA1 split=layer draft=yes", "z ctx=- devices=- split=tensor draft=no"]);
});
