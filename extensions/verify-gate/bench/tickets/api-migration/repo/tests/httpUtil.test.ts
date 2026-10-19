import assert from "node:assert/strict";
import test from "node:test";
import { call, transport } from "../src/httpUtil.ts";

test("call returns what the transport returns", () => {
	const orig = transport.doRequest;
	transport.doRequest = () => "body";
	try {
		assert.equal(call("http://x.invalid/"), "body");
	} finally {
		transport.doRequest = orig;
	}
});
