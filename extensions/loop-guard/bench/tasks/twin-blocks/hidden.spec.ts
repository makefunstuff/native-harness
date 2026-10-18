import assert from "node:assert/strict";
import { test } from "node:test";
import { ENVS } from "./deploy/envs.ts";

test("production", () => {
	assert.deepEqual(ENVS.production(), { name: "production", timeout: 120, retries: 5, canary: true, region: "eu-north-1" });
});

test("others unchanged", () => {
	assert.deepEqual(ENVS.staging(), { name: "staging", timeout: 60, retries: 3, canary: true });
	assert.deepEqual(ENVS.dev(), { name: "dev", timeout: 30, retries: 1 });
});
