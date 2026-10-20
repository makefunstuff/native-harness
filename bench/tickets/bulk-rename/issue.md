API change in `shop` (every module under `shop/`):

`calcTotal(items, tax)` in `shop/money.ts` becomes `orderTotal(items, { taxRate })`: the tax rate
moves into an options object and is renamed to `taxRate`. Results must not change — the totals are
exact cents, and every module's numbers must stay the same to the cent.

1. Add `orderTotal` to `shop/money.ts` and move every call site in every module of `shop/` to it
   (`orderTotal(items, { taxRate: ... })`). No file other than `shop/money.ts` may mention
   `calcTotal` afterwards. Call sites are written two ways: straight to `money.ts`, and through a
   module's own `totalWith` wrapper (update the wrapper's body).
2. Keep `calcTotal(items, tax)` in `shop/money.ts` as a deprecated alias: it must emit a
   `DeprecationWarning` (with `process.emitWarning(message, "DeprecationWarning")`) and return the
   same value as `orderTotal`.
3. `orderTotal` must throw a `TypeError` when the tax rate is passed positionally (a number as the
   second argument) or missing.
4. Update README.md to document `orderTotal`, and update the existing test to use it.

Run the tests with: node --test tests/*.test.ts
