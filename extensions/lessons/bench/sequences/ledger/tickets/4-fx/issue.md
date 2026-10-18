Add `convertCents(amount: Cents, rate: number): Cents` in `src/ops/fx.ts`: convert an amount to
another currency at the given exchange rate, in whole cents of the target currency. Amounts can
be negative (refunds).

- The amount must be integer cents (error code `INVALID_AMOUNT` otherwise).
- The rate must be a finite number above 0; anything else is an error with code `INVALID_RATE`.

The billing service needs to be able to call it.
