import assert from "node:assert/strict";
import { test } from "node:test";
import { orderTotal } from "../shop/money.ts";

test("total with tax", () => {
	assert.equal(orderTotal([[2.5, 4]], { taxRate: 0.2 }), 12);
});
