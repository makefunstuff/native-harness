In `src/handlers.ts`, three handlers need changes; leave every other handler exactly as it is.

1. `RefundHandler.validate` must also reject a payload whose `amount` is present and negative:
   throw `new Invalid("refund: negative amount")`.
2. `ShipmentHandler.serialise` must add `tracking: item.tracking ?? ""` to the output (keep
   the `type` key).
3. `CouponHandler.load` must upper-case string ids before looking them up (`"ab"` -> `"AB"`);
   other ids are looked up unchanged.

Add tests for the three changes to `tests/handlers.test.ts`.
Run the tests with: node --test tests/*.test.ts
