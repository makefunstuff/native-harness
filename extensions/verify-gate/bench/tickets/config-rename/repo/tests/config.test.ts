import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { describe } from "../src/server.ts";

test("defaults", () => {
	const cfg = loadConfig({});
	assert.equal(cfg.host, "localhost");
	assert.equal(cfg.port, 8080);
	assert.match(describe(cfg), /localhost:8080/);
});
