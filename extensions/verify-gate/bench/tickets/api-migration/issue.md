Migrate timeouts from seconds to milliseconds across `src/httpUtil.ts` and `src/cli.ts`, keeping
every existing caller working:

- `call(url, timeout?)` in `src/httpUtil.ts`:
  - new form `call(url, { timeoutMs })`, in milliseconds;
  - legacy forms keep their meaning (seconds) and are converted: `call(url, 5)` and
    `call(url, { timeout: 5 })`;
  - giving both `timeout` and `timeoutMs` throws a `TypeError`;
  - `timeoutMs: 0` is a real zero-millisecond timeout, distinct from omitted; omitted (or
    `undefined` / `null`) uses `DEFAULT_TIMEOUT_MS = 30000`;
  - the request goes through `transport.doRequest(url, timeoutMs)`, which must receive an
    integer number of milliseconds (round to the nearest). Never do real network I/O.
- `src/cli.ts`: `parseArgs(argv)` returns `{ url, timeoutMs }`. `--timeout-ms N` (default 30000) is
  the main flag; the legacy `--timeout S` (seconds) is still accepted and converted. Passing both
  throws a `UsageError`. `helpText()` must be truthful about the units: milliseconds for
  `--timeout-ms`, seconds and "deprecated" for `--timeout`.
- Do not edit `src/legacyCalls.ts`; its functions must keep working (they pass seconds).
