Rename the config key `timeout` to `timeout_s` everywhere in the `svc` package
(`svc/config.py`, `svc/client.py`, `svc/server.py`), without breaking existing users:

- `load_config(dict)` accepts `timeout_s`. The old key `timeout` is still accepted but
  emits a `DeprecationWarning` (via `warnings.warn`) and its value is used as `timeout_s`.
- If both `timeout` and `timeout_s` are given, raise `ValueError`.
- The returned `Config` object exposes `timeout_s`; the old attribute `config.timeout`
  must keep working as a read-only alias that also emits a `DeprecationWarning`.
- `timeout_s` must be a positive number (int or float); otherwise raise `ValueError`.
  The default stays 30.
- `Client` and `Server` must use `timeout_s` internally (no deprecation warnings when
  they are used with a new-style config).
Run the tests with: python3 -m unittest discover -s tests
