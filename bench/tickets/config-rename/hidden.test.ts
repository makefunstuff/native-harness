import assert from "node:assert/strict";
import test from "node:test";
import { requestOptions } from "./src/client.ts";
import { ConfigError, loadConfig } from "./src/config.ts";
import { describe } from "./src/server.ts";

const quiet = () => {};

test("new key, default, no legacy property", () => {
	const cfg = loadConfig({ requestTimeoutMs: 2500 }, quiet) as any;
	assert.equal(cfg.requestTimeoutMs, 2500);
	assert.equal("timeout" in cfg, false);
	assert.equal((loadConfig({}, quiet) as any).requestTimeoutMs, 30000);
});

test("legacy seconds are converted and warned about once", () => {
	const warnings: string[] = [];
	const cfg = loadConfig({ timeout: 2.5 }, (m) => warnings.push(m)) as any;
	assert.equal(cfg.requestTimeoutMs, 2500);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /\btimeout\b/);
	assert.match(warnings[0], /requestTimeoutMs/);
	const none: string[] = [];
	loadConfig({ requestTimeoutMs: 10 }, (m) => none.push(m));
	assert.equal(none.length, 0);
});

test("warn defaults to console.warn", () => {
	const orig = console.warn;
	const seen: unknown[] = [];
	console.warn = (...a: unknown[]) => void seen.push(a.join(" "));
	try {
		loadConfig({ timeout: 1 });
	} finally {
		console.warn = orig;
	}
	assert.equal(seen.length, 1);
});

test("both keys, or bad values, throw ConfigError", () => {
	assert.throws(() => loadConfig({ timeout: 1, requestTimeoutMs: 1000 }, quiet), ConfigError);
	for (const v of [0, -5, 1.5, "100"]) assert.throws(() => loadConfig({ requestTimeoutMs: v }, quiet), ConfigError, String(v));
	for (const v of [0, -1, "3"]) assert.throws(() => loadConfig({ timeout: v }, quiet), ConfigError, String(v));
});

test("client and server use milliseconds", () => {
	const cfg = loadConfig({ host: "h", port: 1, requestTimeoutMs: 2500 }, quiet);
	assert.equal(requestOptions(cfg).timeoutMs, 2500);
	assert.match(describe(cfg), /timeout 2500 ms/);
	assert.equal(requestOptions(loadConfig({ timeout: 3 }, quiet)).timeoutMs, 3000);
});
