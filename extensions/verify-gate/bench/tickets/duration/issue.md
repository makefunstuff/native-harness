`parseDuration` in `src/duration.ts` only takes one unit (`90s`, `5m`, `2h`). Extend it:

- compound durations, units from largest to smallest and each at most once: `1h30m`, `2m5s`,
  `1h2m3s4ms`;
- milliseconds: `250ms`;
- the result stays in milliseconds; whole numbers only. Anything else (empty, a bare number,
  unknown or repeated units, units out of order, signs, decimals, spaces) throws a `RangeError`.
