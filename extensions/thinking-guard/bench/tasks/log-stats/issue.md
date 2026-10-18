Two bugs reported against `logstats` (see `parser.ts`):

1. Our Tallinn servers log local time with an offset (e.g. `2026-10-01T12:00:00+03:00`), but the
   report shows request times shifted by 3 hours. `parseLine` must return `time` as a `Date` for
   the exact instant the line names (the offset applied). Lines ending in `Z` are UTC.
2. `p95Latency` gives wrong values for small samples. It must use the nearest-rank method: sort
   the latencies and take the value at rank ceil(0.95 * n) (1-based). An empty input must throw
   a `RangeError`.

Malformed lines must throw a `SyntaxError` (not a `TypeError` or anything else, and never
return a result with `NaN` or an invalid date in it).
Fix the bugs; keep the public API (`parseLine`, `p95Latency`) unchanged.
Run the tests with: `node --test tests/`
