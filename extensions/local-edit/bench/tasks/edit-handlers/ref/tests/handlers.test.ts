import assert from "node:assert/strict";
import { test } from "node:test";
import { NotFound, OrderHandler, UserHandler, key } from "../src/handlers.ts";

test("user", () => {
  const h = new UserHandler(new Map([[key("user", 1), { name: "a" }]]));
  assert.deepEqual(JSON.parse(h.handle({ id: 1 })), { name: "a", type: "user" });
});

test("missing", () => {
  assert.throws(() => new OrderHandler(new Map()).handle({ id: 2 }), NotFound);
});
