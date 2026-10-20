`summarize()` in `src/logstats.ts` produces wrong reports. Access log lines look like

    2026-10-12T23:30:00+02:00 GET /api/items 200 123ms

(timestamp with UTC offset, method, path, status, duration). Three bugs were reported:

1. Hour buckets are wrong for lines whose offset is not UTC. `byHourUtc` must count requests per
   UTC hour, keyed `YYYY-MM-DDTHH` (so the line above belongs to `2026-10-12T21`).
2. `p95Ms` is off: it must be the nearest-rank 95th percentile of the durations, i.e. the smallest
   duration such that at least 95% of the durations are less than or equal to it. With no valid
   lines it is `null`.
3. A malformed line (wrong number of fields, a timestamp that is not a valid date-time with offset,
   a status that is not a 3-digit number, a duration that is not an integer followed by `ms`)
   crashes the report. Such lines must be skipped and counted in `malformed`; `count` counts the
   valid lines only.
