import assert from "node:assert/strict";
import { test } from "node:test";
import { calcTotal, money } from "../shop/money.ts";

test("total with tax", () => {
	assert.equal(money(calcTotal([[10, 2], [1.5, 1]], 0.2)), "25.80");
});
