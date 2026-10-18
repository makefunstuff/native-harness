In `shop/handlers.py`, three handlers need changes; leave every other handler exactly as it is.

1. `RefundHandler.validate` must also reject a payload whose `amount` is present and negative:
   raise `Invalid("refund: negative amount")`.
2. `ShipmentHandler.serialise` must add `"tracking": item.get("tracking", "")` to the output
   (keep the `type` key).
3. `CouponHandler.load` must upper-case string ids before looking them up (`"ab"` -> `"AB"`);
   non-string ids are looked up unchanged.

Add tests for the three changes to `tests/test_handlers.py`.
Run the tests with: python3 -m unittest discover -s tests
