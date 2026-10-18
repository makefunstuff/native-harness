import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { audit } from "./shop/audit.ts";
import { cartTotal } from "./shop/cart.ts";
import { checkout } from "./shop/checkout.ts";
import { applyCoupon } from "./shop/coupons.ts";
import { toCsv } from "./shop/exports.ts";
import { invoiceLines } from "./shop/invoice.ts";
import * as money from "./shop/money.ts";
import { register } from "./shop/pos.ts";

const ITEMS: money.Item[] = [[2.5, 4], [0.99, 3], [10, 1]];
const ORDERS = [{ id: "a", items: ITEMS, tax: 0.2 }, { id: "b", items: [[1.15, 3]] as money.Item[], tax: 0.07 }];

test("orderTotal and the module results are unchanged", () => {
	assert.equal(money.orderTotal(ITEMS, { taxRate: 0.2 }), 27.56);
	assert.equal(cartTotal({ items: ITEMS, tax: 0.07 }), 24.58);
	assert.equal(checkout(ITEMS, "EU"), 27.56);
	assert.equal(checkout(ITEMS, "XX"), 22.97);
	assert.equal(applyCoupon(ITEMS, 0.2, 0.5), 13.78);
	assert.deepEqual(invoiceLines(ORDERS), ["a: 27.56", "b: 3.69"]);
	assert.equal(register(ITEMS), 25.27);
	assert.equal(Math.round(audit(ORDERS) * 100) / 100, 31.25);
	assert.equal(toCsv(ORDERS), "id,lines,total\na,3,27.56\nb,1,3.69");
});

test("orderTotal rejects a positional rate", () => {
	assert.throws(() => (money.orderTotal as any)(ITEMS, 0.2), TypeError);
	assert.throws(() => (money.orderTotal as any)(ITEMS), TypeError);
});

test("calcTotal is a deprecated alias", () => {
	const seen: string[] = [];
	const orig = process.emitWarning;
	(process as any).emitWarning = (msg: any, type: any) => void seen.push(String(type ?? msg?.name));
	try {
		assert.equal((money as any).calcTotal(ITEMS, 0.2), 27.56);
	} finally {
		process.emitWarning = orig;
	}
	assert.ok(seen.some((t) => /DeprecationWarning/.test(t)), JSON.stringify(seen));
});

test("no other file mentions calcTotal; README and test updated", () => {
	for (const f of readdirSync("shop")) if (f !== "money.ts") assert.doesNotMatch(readFileSync(join("shop", f), "utf8"), /calcTotal/, f);
	assert.match(readFileSync("README.md", "utf8"), /orderTotal/);
	assert.match(readFileSync("tests/money.spec.ts", "utf8"), /orderTotal/);
});
