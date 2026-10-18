Production incident: under load, `TTLCache.getOrCompute(key, fn)` (in `ttlCache.ts`) runs the
expensive async loader `fn` many times for the same key at once (we saw 40 parallel database
queries for one key after a deploy). Required behaviour:

- For a given key, `fn` runs at most once at a time. Concurrent callers for the same key wait
  for that one computation and all receive its result.
- Different keys must NOT block each other: loaders for different keys run in parallel.
- If `fn` rejects, every caller waiting on that computation gets the same error, and nothing is
  cached (the next call tries again).
- Entries expire `ttl` seconds after they were stored; an expired entry is recomputed. Use a
  monotonic clock. The constructor takes an optional `clock` function returning seconds
  (default: `performance.now() / 1000`) so tests can control time.
- `cache.size` is the number of non-expired entries.

Keep the class name and the `getOrCompute` signature.
Run the tests with: `node --test tests/`
