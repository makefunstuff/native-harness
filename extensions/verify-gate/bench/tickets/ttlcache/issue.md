Production incident: under load, `TtlCache.getOrCompute(key, fn)` (in `src/ttlcache.ts`) runs the
expensive loader `fn` many times for the same key at once (we saw 40 parallel database queries for
one key after a deploy). Required behaviour:

- For a given key, `fn` runs at most once at a time. Concurrent callers for the same key wait for
  that one computation and all receive its result.
- Different keys must NOT wait for each other: loaders for different keys run concurrently.
- If `fn` rejects, every caller waiting on that computation gets the same error, and nothing is
  cached (the next call tries again).
- An entry stored at time `t` is fresh while `now - t < ttlMs`; an entry that is not fresh is
  recomputed. Use a monotonic clock. The constructor takes an optional second argument
  `{ now?: () => number }` (milliseconds, default `performance.now`) so tests can control time.
- `size` returns the number of fresh entries.

Keep the class name and the `getOrCompute` signature.
