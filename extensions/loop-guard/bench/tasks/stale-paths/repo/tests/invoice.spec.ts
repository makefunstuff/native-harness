import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceTotal, lineTotal } from "../billing/invoice.ts";

test("simple line", () => {
	assert.equal(lineTotal(3, "2.5"), 750);
});

test("invoice total", () => {
	assert.equal(invoiceTotal([[1, "1.25"], [2, "2"]]), 525);
});
