Add `splitEvenly(total: Cents, parts: number): Cents[]` in `src/ops/split.ts`: split an amount into
`parts` amounts that add up to `total` and differ by at most one cent; the first amounts get the
extra cents (100 in 3 parts is `[34, 33, 33]`).

- A negative total is an error with code `NEGATIVE_AMOUNT`.
- `parts` must be a positive integer; anything else is an error with code `INVALID_PARTS`.

The billing service needs to be able to call it.
