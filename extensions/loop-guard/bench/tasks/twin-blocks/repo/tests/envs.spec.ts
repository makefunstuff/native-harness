import assert from "node:assert/strict";
import { test } from "node:test";
import { ENVS } from "../deploy/envs.ts";

test("names match", () => {
	for (const [name, fn] of Object.entries(ENVS)) assert.equal(fn().name, name);
});
