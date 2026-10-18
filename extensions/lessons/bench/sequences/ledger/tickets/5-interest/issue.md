Add `simpleInterest(principal: Cents, annualPct: number, days: number): Cents` in
`src/ops/interest.ts`: simple interest on a principal for a number of days, with a 365-day year
(`principal × annualPct / 100 × days / 365`), in whole cents.

- A negative principal is an error with code `NEGATIVE_AMOUNT`.
- `days` must be an integer ≥ 0 (error code `INVALID_DAYS`); a negative or non-finite rate is an
  error with code `INVALID_RATE`.

The billing service needs to be able to call it.
