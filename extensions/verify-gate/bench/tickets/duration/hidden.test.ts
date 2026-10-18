import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseDuration } from "./src/duration.ts";

test("compound durations and milliseconds", () => {
	assert.equal(parseDuration("1h30m"), 5_400_000);
	assert.equal(parseDuration("2m5s"), 125_000);
	assert.equal(parseDuration("1h2m3s4ms"), 3_723_004);
	assert.equal(parseDuration("250ms"), 250);
	assert.equal(parseDuration("0s"), 0);
	assert.equal(parseDuration("90s"), 90_000);
	assert.equal(parseDuration("2h"), 7_200_000);
});

test("invalid input throws RangeError", () => {
	for (const t of ["", "5", "1x", "1h-5m", "1.5h", " 1h", "1h ", "h", "1h1h", "5s1m", "1m1h", "10msx"]) assert.throws(() => parseDuration(t), RangeError, JSON.stringify(t));
});

test("the change is in the changelog, under Unreleased (project rule)", () => {
	const log = readFileSync(new URL("./CHANGELOG.md", import.meta.url), "utf8");
	const unreleased = log.split(/^## /m).find((s) => s.startsWith("Unreleased")) ?? "";
	assert.match(unreleased, /^\s*[-*] .*\S/m);
});
