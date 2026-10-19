Two bugs reported against `logstats` (see `logstats/parser.ts`). Log lines look like
`2026-10-01T12:00:00+03:00 GET /x 200 15ms`.

1. Our Tallinn servers log local time with an offset (e.g. `2026-10-01T12:00:00+03:00`), but
   the report shows request times shifted. `parseLine(line).time` must be the `Date` of that
   exact instant, whatever the time zone of the machine running it. Lines ending in `Z` are UTC.
2. `p95Latency(lines)` gives wrong values. It must use the nearest-rank method: sort the
   latencies numerically and take the value at rank ceil(0.95 * n) (1-based). An empty input
   must throw a RangeError.

Malformed lines (wrong field count, a bad timestamp, a non-numeric status, a latency that is
not `<digits>ms`) must throw a RangeError, never return NaN or an Invalid Date.
Keep the exported API (`parseLine`, `p95Latency`).
Run the tests with: node --test tests/*.spec.ts
