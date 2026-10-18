import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "./textkit/slugify.ts";

test("examples", () => {
	assert.equal(slugify("Crème Brûlée -- Recipe!"), "creme-brulee-recipe");
	assert.equal(slugify("  Hello,   World  "), "hello-world");
	assert.equal(slugify("Ünïcödé 2026"), "unicode-2026");
	assert.equal(slugify("a_b.c"), "a-b-c");
});

test("empty result throws", () => {
	for (const bad of ["", "   ", "!!!", "--"]) assert.throws(() => slugify(bad), RangeError, bad);
});
