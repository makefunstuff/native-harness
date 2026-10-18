import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../textkit/slugify.ts";

test("plain", () => {
	assert.equal(slugify("hello world"), "hello-world");
});
