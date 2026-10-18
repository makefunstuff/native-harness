import assert from "node:assert/strict";
import { test } from "node:test";
import { RATES, gross } from "../src/vat.ts";

test("gross", () => {
  assert.equal(gross(100, "AT"), 100 + RATES.at.standard);
});
