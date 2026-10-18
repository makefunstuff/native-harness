Production incident: under load, `TTLCache.get_or_compute(key, fn)` (in `ttlcache.py`)
runs the expensive loader `fn` many times for the same key at once (we saw 40 parallel
database queries for one key after a deploy). Required behaviour:

- For a given key, `fn` runs at most once at a time. Concurrent callers for the same key
  wait for that one computation and all receive its result.
- Different keys must NOT block each other: loaders for different keys run in parallel.
- If `fn` raises, every caller waiting on that computation gets the same exception, and
  nothing is cached (the next call tries again).
- Entries expire `ttl` seconds after they were stored; an expired entry is recomputed.
  Use a monotonic clock. The constructor takes an optional `clock` callable (default
  `time.monotonic`) so tests can control time.
- `len(cache)` returns the number of non-expired entries.
Keep the class name and the `get_or_compute` signature.
Run the tests with: python3 -m unittest discover -s tests
