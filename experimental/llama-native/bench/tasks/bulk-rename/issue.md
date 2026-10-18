API change in `shop` (all modules under `shop/`):

`shop.money.calc_total(items, tax)` becomes `shop.money.order_total(items, *, tax_rate)`:
the tax rate is keyword-only and renamed to `tax_rate`. Results must not change.

1. Add `order_total` and move every call site in every module of `shop/` to it
   (`order_total(items, tax_rate=...)`). No module other than `shop/money.py` may mention
   `calc_total` afterwards.
2. Keep `calc_total(items, tax)` in `shop/money.py` as a deprecated alias: it must emit a
   `DeprecationWarning` and return the same value as `order_total`.
3. `order_total` must raise `TypeError` when the tax rate is passed positionally.
4. Update README.md to document `order_total`, and update the existing test to use it.

Run the tests with: python3 -m unittest discover -s tests
