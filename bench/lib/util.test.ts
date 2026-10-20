import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendRow, applyDiff, cacheDirFor, commitAll, diffOf, doneKeys, flag, fmt, git, mean, median, opt, pct, positional, readRows, stripTerminalEnv, table, useTmpDir, writeRows } from "./util.ts";

const t = () => mkdtempSync(join(tmpdir(), "pi-bench-util-"));

test("mean, median and the table number format", () => {
	assert.equal(mean([1, 2, 10]), 13 / 3);
	assert.equal(median([10, 1, 2, 3]), 2.5);
	assert.equal(median([3, 1, 2]), 2);
	assert.ok(Number.isNaN(mean([]))); // no samples is not zero
	assert.ok(Number.isNaN(median([])));
	assert.equal(fmt(1234.5678), "1,234.6");
	assert.equal(fmt(0.5, 3), "0.500");
	assert.equal(fmt(Number.NaN), "–");
	assert.equal(pct(0.5), "50%");
	assert.equal(pct(1 / 3, 2), "33.33%");
});

test("row files append, read back, and index by arm#task#round", () => {
	const dir = t();
	const f = join(dir, "rows.jsonl");
	appendRow(f, { arm: "off", task: "a", round: 1, passed: true });
	appendRow(f, { arm: "gate", task: "b", round: 2, passed: false });
	writeRows(f, readRows(f).slice(0, 1));
	assert.deepEqual(readRows(f), [{ arm: "off", task: "a", round: 1, passed: true }]);
	assert.deepEqual(doneKeys([{ arm: "off", task: "a", round: 1 }, { arm: "gate", task: "a", round: 1 }]), new Set(["off#a#1", "gate#a#1"]));
});

test("markdown tables: header, separator, one line per row", () => {
	const md = table(["arm", "pass"], [
		["off", "1/2"],
		["verify-gate", "2/2"],
	]).join("\n");
	const lines = md.split("\n");
	assert.equal(lines[0], "| arm | pass |");
	assert.equal(lines[1], "|---|---|");
	assert.equal(lines.length, 4);
	assert.match(lines[3], /verify-gate/);
});

test("git helpers: seed, commit, diff, re-apply", () => {
	const dir = t();
	writeFileSync(join(dir, "a.txt"), "one\n");
	commitAll(dir);
	writeFileSync(join(dir, "a.txt"), "two\n");
	const d = diffOf(dir);
	assert.match(d, /a\.txt/);
	assert.match(d, /\+two/);

	const copy = t();
	writeFileSync(join(copy, "a.txt"), "one\n");
	assert.equal(applyDiff(copy, d), true);
	assert.equal(readFileSync(join(copy, "a.txt"), "utf8"), "two\n");
	assert.equal(applyDiff(copy, d), false); // already applied
});

test("command-line options and the bench environment", () => {
	const argv = process.argv;
	process.argv = ["node", "run.ts", "--arms", "off,d3", "--tasks=cli-json", "--dry-run", "extra", "--ext"];
	try {
		assert.equal(opt("arms"), "off,d3");
		assert.equal(opt("tasks"), "cli-json");
		assert.equal(opt("missing", "def"), "def");
		assert.equal(flag("dry-run"), true);
		assert.equal(flag("verbose"), false);
		assert.deepEqual(positional(), []); // a bare word after --dry-run is read as its value
		process.argv = ["node", "run.ts", "bulk-rename", "--arms", "off", "--dry-run", "--ext", "x.ts"];
		assert.deepEqual(positional(), ["bulk-rename"]);
	} finally {
		process.argv = argv;
	}

	const cache = t();
	assert.equal(useTmpDir(cache), join(cache, "tmp"));
	assert.equal(process.env.TMPDIR, join(cache, "tmp"));
	process.env.HERDR_PANE_ID = "pane";
	process.env.ORCA_THING = "1";
	process.env.KEEP_ME = "yes";
	stripTerminalEnv();
	assert.equal(process.env.HERDR_PANE_ID, undefined);
	assert.equal(process.env.ORCA_THING, undefined);
	assert.equal(process.env.KEEP_ME, "yes");
	delete process.env.KEEP_ME;

	const saved = process.env.PI_EXTRAS_CACHE;
	process.env.PI_EXTRAS_CACHE = cache;
	assert.equal(cacheDirFor("x"), cache);
	delete process.env.PI_EXTRAS_CACHE;
	assert.match(cacheDirFor("x"), /\/.cache\/pi-extras\/x$/);
	process.env.PI_EXTRAS_CACHE = saved;
});
