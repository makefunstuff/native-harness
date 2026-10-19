Rename the config key `timeout` (seconds) to `requestTimeoutMs` (milliseconds) everywhere in
`src/` (config, client, server):

- `loadConfig(raw, warn?)` returns `requestTimeoutMs` (a positive integer number of
  milliseconds, default 30000) instead of `timeout`; the returned config has no `timeout` property.
- The old key is still accepted for one release: `{ timeout: 2.5 }` means 2500 ms. Using it calls
  `warn(message)` once per `loadConfig` call with a message that names both `timeout` and
  `requestTimeoutMs` (`warn` defaults to `console.warn`).
- Giving both keys throws `ConfigError`. So does a `requestTimeoutMs` that is not a positive
  integer, or a legacy `timeout` that is not a positive number.
- The client and the server use the new value: `requestOptions(cfg).timeoutMs` and
  `describe(cfg)`, which must show the timeout as e.g. `timeout 2500 ms`.
