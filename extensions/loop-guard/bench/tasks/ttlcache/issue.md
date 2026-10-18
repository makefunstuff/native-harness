Production incident: under load, `TTLCache.getOrCompute(key, fn)` (in `ttlcache.ts`) runs the
expensive async loader `fn` many times for the same key at once (we saw 40 parallel database
queries for one key after a deploy). Required behaviour:

- For a given key, `fn` runs at most once at a time. Concurrent callers for the same key wait
  for that one computation and all receive its result.
- Different keys must NOT wait for each other: loaders for different keys run concurrently.
- If `fn` rejects, every caller waiting on that computation gets the same error, and nothing is
  cached (the next call tries again).
- Entries expire `ttlMs` milliseconds after they were stored; an expired entry is recomputed.
  The constructor takes an optional `clock` function (default `performance.now`) so tests can
  control time.
- `cache.size` is the number of non-expired entries.
Keep the class name, the constructor signature and the `getOrCompute` signature.
Run the tests with: node --test tests/*.spec.ts
