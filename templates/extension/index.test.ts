import assert from "node:assert/strict";
import { test } from "node:test";
import { fakePi } from "../../test/lib/fake-pi.ts";
import extension, { shout } from "./index.ts";

test("shout upper-cases", () => {
	assert.equal(shout("ok"), "OK");
});

test("registers template_shout and runs it", async () => {
	const pi = fakePi();
	extension(pi as any);
	const tool = pi.tools.get("template_shout");
	assert.ok(tool, "tool registered");
	const res = await tool.execute("id", { text: "hi" });
	assert.equal(res.content[0].text, "HI");
});
