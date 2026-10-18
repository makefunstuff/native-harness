API change in `shop` (every module under `shop/`):

`calcTotal(items, tax)` in `shop/money.ts` becomes `orderTotal(items, { taxRate })`: the tax
rate moves into an options object and is renamed to `taxRate`. Results must not change.

1. Add `orderTotal` to `shop/money.ts` and move every call site in every module of `shop/` to
   it. No file other than `shop/money.ts` may mention `calcTotal` afterwards.
2. Keep `calcTotal(items, tax)` in `shop/money.ts` as a deprecated alias: it must emit a
   warning with `process.emitWarning(message, "DeprecationWarning")` and return the same value
   as `orderTotal`.
3. `orderTotal` must throw a TypeError when the second argument is not an object with a
   numeric `taxRate` (e.g. when the rate is passed as a plain number).
4. Update README.md to document `orderTotal`, and update the existing test to use it.

Run the tests with: node --test tests/*.spec.ts
