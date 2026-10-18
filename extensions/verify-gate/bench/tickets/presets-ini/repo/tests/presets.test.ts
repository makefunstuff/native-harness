import assert from "node:assert/strict";
import test from "node:test";
import { loadPresets } from "../src/presets.ts";

test("sample.ini", () => {
	const p = loadPresets(new URL("../sample.ini", import.meta.url).pathname);
	assert.deepEqual(Object.keys(p), ["qwen3.8-27b", "zeta-2.1-q4"]);
	assert.equal(p["zeta-2.1-q4"].temp, "0.0");
});
