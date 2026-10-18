import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../src/inventory.ts";

test("table report, sorted, filtered by --min-qty", () => {
	let out = "";
	const io = { readFile: () => "name,qty,price\npear,3,0.5\napple,10,1.25\n", out: (t: string) => void (out += t), err: () => {} };
	assert.equal(main(["items.csv", "--min-qty", "5"], io), 0);
	assert.equal(out, "apple                    10       1.25\n");
});
