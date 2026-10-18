import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { UsageError, helpText, parseArgs } from "./src/cli.ts";
import * as http from "./src/httpUtil.ts";
import { fetchDefault, fetchReport, fetchStatus } from "./src/legacyCalls.ts";

function capture(fn: () => unknown): Array<[string, number]> {
	const seen: Array<[string, number]> = [];
	const orig = http.transport.doRequest;
	http.transport.doRequest = (url: string, ms: number) => (seen.push([url, ms]), "ok");
	try {
		fn();
	} finally {
		http.transport.doRequest = orig;
	}
	return seen;
}
const ms = (fn: () => unknown) => capture(fn)[0][1];

test("DEFAULT_TIMEOUT_MS", () => {
	assert.equal((http as any).DEFAULT_TIMEOUT_MS, 30000);
});

test("new form in milliseconds; omitted, undefined and null use the default", () => {
	assert.equal(ms(() => http.call("u", { timeoutMs: 1500 } as any)), 1500);
	assert.equal(ms(() => http.call("u")), 30000);
	assert.equal(ms(() => http.call("u", { timeoutMs: undefined } as any)), 30000);
	assert.equal(ms(() => http.call("u", { timeoutMs: null } as any)), 30000);
	assert.equal(ms(() => http.call("u", null as any)), 30000);
});

test("zero is a real timeout", () => {
	assert.equal(ms(() => http.call("u", { timeoutMs: 0 } as any)), 0);
});

test("legacy seconds are converted to integer milliseconds", () => {
	assert.equal(ms(() => http.call("u", 5 as any)), 5000);
	assert.equal(ms(() => http.call("u", { timeout: 2.5 } as any)), 2500);
	const v = ms(() => http.call("u", { timeout: 0.0015 } as any));
	assert.ok(Number.isInteger(v) && v === 2, String(v));
	assert.ok(Number.isInteger(ms(() => http.call("u", { timeoutMs: 10.6 } as any))));
});

test("both keys: TypeError, no request", () => {
	let calls = 0;
	const orig = http.transport.doRequest;
	http.transport.doRequest = () => (calls++, "x");
	try {
		assert.throws(() => http.call("u", { timeout: 1, timeoutMs: 1000 } as any), TypeError);
	} finally {
		http.transport.doRequest = orig;
	}
	assert.equal(calls, 0);
});

test("legacy call sites still work, unchanged", () => {
	assert.deepEqual(capture(fetchStatus), [["http://status.invalid/", 5000]]);
	assert.deepEqual(capture(fetchReport), [["http://report.invalid/", 2500]]);
	assert.deepEqual(capture(fetchDefault), [["http://default.invalid/", 30000]]);
	const src = readFileSync(new URL("./src/legacyCalls.ts", import.meta.url), "utf8");
	assert.match(src, /call\("http:\/\/status\.invalid\/", 5\)/);
	assert.match(src, /\{ timeout: 2\.5 \}/);
});

test("cli: --timeout-ms, legacy --timeout, both is a usage error", () => {
	assert.deepEqual(parseArgs(["http://a"]), { url: "http://a", timeoutMs: 30000 });
	assert.deepEqual(parseArgs(["--timeout-ms", "250", "http://a"]), { url: "http://a", timeoutMs: 250 });
	assert.deepEqual(parseArgs(["http://a", "--timeout", "3"]), { url: "http://a", timeoutMs: 3000 });
	assert.deepEqual(parseArgs(["http://a", "--timeout-ms", "0"]), { url: "http://a", timeoutMs: 0 });
	assert.throws(() => parseArgs(["http://a", "--timeout", "1", "--timeout-ms", "5"]), UsageError);
});

test("cli help is truthful about units", () => {
	const lines = helpText().split("\n").filter((l) => !/usage/i.test(l));
	const ms = lines.filter((l) => l.includes("--timeout-ms")).join("\n");
	const legacy = lines.filter((l) => /--timeout(?![-\w])/.test(l)).join("\n");
	assert.match(ms, /millisecond/i);
	assert.match(legacy, /second/i);
	assert.match(legacy, /deprecated/i);
});
