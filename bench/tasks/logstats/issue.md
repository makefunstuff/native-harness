Two bugs reported against `logstats` (see `logstats/parser.py`):

1. Our Tallinn servers log local time with an offset (e.g. `2026-10-01T12:00:00+03:00`),
   but the report shows request times shifted by 3 hours. `parse_line` must return the
   timestamp as a timezone-aware datetime in UTC. Lines ending in `Z` are UTC too.
2. `p95_latency` gives wrong values for small samples. It must use the nearest-rank
   method: sort the latencies and take the value at rank ceil(0.95 * n) (1-based).
   An empty input must raise ValueError.

Malformed lines must raise ValueError (not IndexError or anything else).
Fix the bugs; keep the public API (`parse_line`, `p95_latency`) unchanged.
Run the tests with: python3 -m unittest discover -s tests
