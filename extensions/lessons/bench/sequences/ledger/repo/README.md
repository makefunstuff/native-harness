# ledger

Small money library used by the billing service. Amounts are integer cents.

- `src/money.ts`: the `Cents` type, rounding and errors
- `src/ops/`: one module per operation
- `src/registry.ts`: the operations the billing service can call
- `docs/`: notes for the billing team

Run the tests with `npm test`.
