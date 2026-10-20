import assert from "node:assert/strict";
import { test } from "node:test";
import { orderTotal, money } from "../shop/money.ts";

test("total with tax", () => {
	assert.equal(money(orderTotal([[10, 2], [1.5, 1]], { taxRate: 0.2 })), "25.80");
});
