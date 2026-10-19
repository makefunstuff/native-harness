Add `applyDiscount(price: Cents, pct: number): Cents` in `src/ops/discount.ts`: the price after a
discount of `pct` percent. The discount amount is rounded to whole cents and then subtracted from
the price.

- A negative price is an error with code `NEGATIVE_AMOUNT`.
- A percentage below 0 or above 100 is an error with code `INVALID_PERCENT`.

The billing service needs to be able to call it.
