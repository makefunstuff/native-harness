Add `vatFor(net: Cents, ratePct: number): Cents` in `src/ops/vat.ts`: the VAT on a net amount at
the given rate, in whole cents. Rates are percentages (20 means 20 %).

- A negative net amount is an error with code `NEGATIVE_AMOUNT`.
- A rate below 0 or above 100 is an error with code `INVALID_RATE`.

The billing service needs to be able to call it.
