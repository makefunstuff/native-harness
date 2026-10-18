import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakeCtx, fakePi } from "../../test/lib/fake-pi.ts";
import { compactDiff } from "./diff.ts";
import extension, { repairArguments } from "./index.ts";
import { EditMatchError, bestSubstring, reindent, resolveEdits, similarity, unescapeLiteral } from "./match.ts";
import { resolveEditPath, strippedVariants } from "./paths.ts";

const PY = `import os


def load(path):
    with open(path) as f:
        data = f.read()
    return data


class Store:
    def __init__(self, root):
        self.root = root
        self.items = {}

    def get(self, key, default=None):
        value = self.items.get(key, default)
        return value

    def put(self, key, value):
        self.items[key] = value
        return True
`;

// --- match.ts

test("similarity: Levenshtein ratio, with a floor cut-off", () => {
	assert.equal(similarity("abc", "abc"), 1);
	assert.equal(similarity("abcd", "abce"), 0.75);
	assert.ok(similarity("a".repeat(100), "b".repeat(100), 0.95) < 0.95);
	assert.ok(similarity("x".repeat(40) + "a", "x".repeat(40) + "b", 0.95) >= 0.95);
});

test("bestSubstring finds an approximate occurrence inside a line", () => {
	const line = "    result = compute_total(items, tax_rate)  # main";
	const b = bestSubstring(line, "compute_totl(items, tax_rate)");
	assert.equal(line.slice(b.start, b.end), "compute_total(items, tax_rate)");
	assert.ok(b.ratio > 0.95);
});

test("exact and pi-fuzzy matches pass through untouched", () => {
	const edits = [{ oldText: "        self.root = root", newText: "        self.root = str(root)" }];
	const r = resolveEdits(PY, edits, "s.py");
	assert.deepEqual(r.edits, edits);
	assert.deepEqual(r.notes, []);
	// trailing whitespace is pi's own fuzzy case
	const r2 = resolveEdits(PY, [{ oldText: "        self.root = root   ", newText: "x" }], "s.py");
	assert.equal(r2.edits[0].oldText, "        self.root = root   ");
});

test("indentation-tolerant: oldText with the wrong indent, newText re-indented", () => {
	const r = resolveEdits(PY, [{ oldText: "def get(self, key, default=None):\n    value = self.items.get(key, default)", newText: "def get(self, key, default=None):\n    return self.items.get(key, default)" }], "s.py");
	assert.equal(r.edits[0].oldText, "    def get(self, key, default=None):\n        value = self.items.get(key, default)");
	assert.equal(r.edits[0].newText, "    def get(self, key, default=None):\n        return self.items.get(key, default)");
	assert.match(r.notes[0], /lines 15-16 \(indentation ignored\)/);
});

test("tabs instead of spaces are re-indented to the file's spaces", () => {
	assert.equal(reindent("\tfoo\n\t\tbar", "\t", "    "), "    foo\n    \tbar");
	assert.equal(reindent("foo\n    bar", "", "    "), "    foo\n        bar");
});

test("a typo in a multi-line oldText is accepted at >= 0.95 when unique", () => {
	const old = "    def put(self, key, value):\n        self.items[key] = vlaue\n        return True";
	const r = resolveEdits(PY, [{ oldText: old, newText: "    def put(self, key, value):\n        self.items[key] = value\n        return False" }], "s.py");
	assert.equal(r.edits[0].oldText, "    def put(self, key, value):\n        self.items[key] = value\n        return True");
	assert.match(r.notes[0], /lines 19-21 \(9\d(\.\d)?% similar\)/);
});

test("a typo in a one-line fragment replaces only that fragment", () => {
	const r = resolveEdits(PY, [{ oldText: "self.items.get(key, defalt)", newText: "self.items.get(key)" }], "s.py");
	assert.equal(r.edits[0].oldText, "self.items.get(key, default)");
	const after = PY.replace(r.edits[0].oldText, r.edits[0].newText);
	assert.match(after, /        value = self\.items\.get\(key\)\n/);
});

test("below the threshold: error lists the closest lines with line numbers", () => {
	assert.throws(
		() => resolveEdits(PY, [{ oldText: "    def put(self, k, v):\n        self.items[k] = v", newText: "" }], "s.py"),
		(e: any) => {
			assert.ok(e instanceof EditMatchError);
			assert.match(e.message, /Could not find the text in s\.py/);
			assert.match(e.message, /lines 19-20 \(\d+% similar\):\n19\|     def put\(self, key, value\):\n20\|         self\.items\[key\] = value/);
			return true;
		},
	);
});

test("ambiguous loose matches are refused, with line numbers", () => {
	const src = "a = compute_value(1)\nb = 2\na = compute_value(1)\n";
	assert.throws(() => resolveEdits(src, [{ oldText: "a = compute_value(1)", newText: "x" }], "f.py"), /matches 2 places in f\.py \(lines 1, 3\)/);
	const src2 = "    total = compute_value(1)\nb\n  total = compute_value(1)\n";
	assert.throws(() => resolveEdits(src2, [{ oldText: "total = compute_valu(1)", newText: "x" }], "f.py"), /several places \(lines 1, 3\)/);
});

test("literal \\n escapes are decoded when that makes a unique match", () => {
	assert.equal(unescapeLiteral("a\\nb"), "a\nb");
	assert.equal(unescapeLiteral("a\nb"), undefined);
	const r = resolveEdits(PY, [{ oldText: "    def put(self, key, value):\\n        self.items[key] = value", newText: "    def put(self, key, value):\\n        pass" }], "s.py");
	assert.equal(r.edits[0].oldText, "    def put(self, key, value):\n        self.items[key] = value");
	assert.equal(r.edits[0].newText, "    def put(self, key, value):\n        pass");
});

test("a window shifted by one line is not accepted over the right one", () => {
	const lines = Array.from({ length: 40 }, (_, i) => `    line_${i} = ${i}`);
	const src = lines.join("\n") + "\n";
	const old = lines.slice(10, 30).join("\n").replace("line_20 = 20", "line_20 = 2O");
	const r = resolveEdits(src, [{ oldText: old, newText: "X" }], "f.py");
	assert.equal(r.edits[0].oldText, lines.slice(10, 30).join("\n"));
});

// --- diff.ts

test("compactDiff keeps one line of context and warns on dropped code", () => {
	const diff = [" 1 a", " 2 b", " 3 c", "-4 d1", "-5 d2", "-6 d3", "+4 e", " 5 f", " 6 g", "   ...", " 40 z"].join("\n");
	const d = compactDiff(diff)!;
	assert.equal(d.removed, 3);
	assert.equal(d.added, 1);
	assert.equal(d.dropped, 3);
	assert.match(d.text, /^Diff \(-3 \+1 lines/);
	assert.ok(!d.text.includes(" 1 a"));
	assert.ok(d.text.includes(" 3 c") && d.text.includes(" 5 f") && !d.text.includes(" 6 g"));
	assert.match(d.text, /Warning: 3 non-blank line\(s\) were removed/);
});

test("compactDiff flags placeholder comments in newText", () => {
	const d = compactDiff(["-3 x = 1", "-4 y = 2", "+3 # ... rest unchanged"].join("\n"))!;
	assert.ok(d.placeholder);
	assert.match(d.text, /placeholder comment/);
	assert.ok(!compactDiff(["-3 x = 1", "+3 x = 2"].join("\n"))!.placeholder);
});

// --- paths.ts

test("path repair: anchors, line suffixes, diff prefixes, basenames", () => {
	const root = mkdtempSync(join(tmpdir(), "local-edit-"));
	try {
		mkdirSync(join(root, "src/pkg"), { recursive: true });
		mkdirSync(join(root, "tests"));
		writeFileSync(join(root, "src/pkg/store.py"), "x");
		writeFileSync(join(root, "src/pkg/util.py"), "x");
		writeFileSync(join(root, "tests/util.py"), "x");
		assert.deepEqual(strippedVariants("a.py#L3").includes("a.py"), true);
		assert.equal(resolveEditPath("src/pkg/store.py", root).note, undefined);
		assert.equal(resolveEditPath("src/pkg/store.py#ab12", root).path, "src/pkg/store.py");
		assert.equal(resolveEditPath("src/pkg/store.py:12-14", root).path, "src/pkg/store.py");
		assert.equal(resolveEditPath("b/src/pkg/store.py", root).path, "src/pkg/store.py");
		assert.equal(resolveEditPath("store.py", root).path, join("src/pkg/store.py"));
		assert.equal(resolveEditPath("pkg/util.py", root).path, join("src/pkg/util.py"));
		assert.match(resolveEditPath("util.py", root).error!, /Several files match.*src\/pkg\/util\.py.*tests\/util\.py|Several files match.*tests\/util\.py.*src\/pkg\/util\.py/);
		assert.equal(resolveEditPath("nothere.py", root).error, undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// --- index.ts

test("repairArguments: aliases and shapes, without touching the input", () => {
	const input = { file_path: "a.py", old_string: "x", new_string: "y" };
	const out: any = repairArguments(input);
	assert.deepEqual(out, { path: "a.py", edits: [{ oldText: "x", newText: "y" }] });
	assert.deepEqual(input, { file_path: "a.py", old_string: "x", new_string: "y" });
	const s: any = repairArguments({ path: "a", edits: JSON.stringify([{ old_text: "1", new_text: "2" }]) });
	assert.deepEqual(s.edits, [{ oldText: "1", newText: "2" }]);
	const one: any = repairArguments({ path: "a", edits: { oldText: "1", newText: "2" } });
	assert.deepEqual(one.edits, [{ oldText: "1", newText: "2" }]);
});

test("the edit tool replaces pi's, keeps its schema, and applies a tolerant edit with a diff", async () => {
	const pi = fakePi();
	extension(pi as any);
	const tool = pi.tools.get("edit");
	assert.ok(tool, "edit registered");
	assert.ok(tool.parameters?.properties?.edits, "same schema as pi's edit");
	assert.match(tool.description, /exact text replacement/);
	const root = mkdtempSync(join(tmpdir(), "local-edit-"));
	try {
		mkdirSync(join(root, "app"));
		writeFileSync(join(root, "app/store.py"), PY);
		const ctx = fakeCtx({ cwd: root });
		const args = tool.prepareArguments({ file_path: "store.py#1a", old_string: "def get(self, key, default=None):\n    value = self.items.get(key, default)\n    return value", new_string: "def get(self, key, default=None):\n    return self.items.get(key, default)" });
		const res = await tool.execute("c1", args, undefined, undefined, ctx);
		const text = res.content[0].text;
		assert.match(text, /Successfully replaced 1 block/);
		assert.match(text, /path "store\.py#1a" resolved to "app\/store\.py"/);
		assert.match(text, /indentation ignored/);
		assert.match(text, /Diff \(-2 \+1 lines/);
		assert.match(text, /-1[5-7]\s+ {8}value = self\.items\.get\(key, default\)/);
		assert.match(readFileSync(join(root, "app/store.py"), "utf8"), /    def get\(self, key, default=None\):\n        return self\.items\.get\(key, default\)\n\n    def put/);
		// a miss: the closest candidates come back instead of pi's bare message
		await assert.rejects(tool.execute("c2", { path: "app/store.py", edits: [{ oldText: "def remove(self, key):\n    del self.items[key]", newText: "" }] }, undefined, undefined, ctx), /Closest text in the file:\n/);
		// CRLF files keep their line endings
		writeFileSync(join(root, "crlf.txt"), "one\r\n  two\r\nthree\r\n");
		await tool.execute("c3", { path: "crlf.txt", edits: [{ oldText: "two\nthree", newText: "2\n3" }] }, undefined, undefined, ctx);
		assert.equal(readFileSync(join(root, "crlf.txt"), "utf8"), "one\r\n  2\r\n3\r\n");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
