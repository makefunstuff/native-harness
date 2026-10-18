Write `presets.py`: a reader for llama.cpp router preset files like `sample.ini` in this
repo, plus a small report CLI. Python standard library only; do NOT use configparser
(it mangles our keys and duplicate handling) — write the parser by hand.

File format:
- `key = value` lines; whitespace around key and value is stripped; the value may itself
  contain `=` (split on the first `=` only).
- Lines whose first non-space character is `#` or `;` are comments; blank lines ignored.
- Keys before the first `[section]` are global defaults inherited by every section;
  a section's own key overrides the default.
- A duplicate section name, or a non-blank, non-comment line that is neither a section
  header nor contains `=`, raises `ValueError` mentioning the 1-based line number.

API:
- `load_presets(path) -> dict[str, dict[str, str]]`: preset name -> merged keys (all values strings),
  in file order.
- `main(argv) -> int`: `python3 presets.py FILE` prints one line per preset:
  `<name> ctx=<ctx-size or '-'> devices=<device or '-'> split=<split-mode, default 'layer'> draft=<yes|no>`
  where draft is `yes` if the preset has a `spec-draft-model` key. Returns 0.
Run the tests with: python3 -m unittest discover -s tests
