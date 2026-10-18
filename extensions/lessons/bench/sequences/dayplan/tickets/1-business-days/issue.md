Add `addBusinessDays(day: Day, n: number): Day` in `src/businessDays.ts`: the day `n` business
days after `day` (before it when `n` is negative), skipping Saturdays and Sundays. `n = 0` returns
`day` unchanged. Starting on a weekend, one business day forward is the Monday. Bad day strings
throw the usual `INVALID_DAY` error.

It is part of the public API.
