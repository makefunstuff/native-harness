import assert from "node:assert/strict";
import { test } from "node:test";
import { calcTotal } from "../shop/money.ts";

test("total with tax", () => {
	assert.equal(calcTotal([[2.5, 4]], 0.2), 12);
});
