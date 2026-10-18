import assert from "node:assert/strict";
import { test } from "node:test";
import { fakePi } from "../../../test/lib/fake-pi.ts";

test("without the built addon the extension registers nothing", async () => {
	process.env.LLAMA_NATIVE_ADDON = "/nonexistent/llama_native.node";
	const { default: extension } = await import("./index.ts");
	const pi = fakePi();
	extension(pi as any);
	assert.equal(pi.providers.size, 0);
	assert.equal(pi.handlers.size, 0);
});
