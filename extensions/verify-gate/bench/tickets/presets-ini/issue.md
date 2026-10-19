Write `src/presets.ts`: a reader for llama.cpp router preset files like `sample.ini` in this repo,
plus a small report CLI. No dependencies, and no INI library: write the parser by hand.

File format:
- `key = value` lines; whitespace around key and value is stripped; the value may itself contain
  `=` (split on the first `=` only).
- Lines whose first non-space character is `#` or `;` are comments; blank lines are ignored.
- Keys before the first `[section]` are global defaults inherited by every section; a section's
  own key overrides the default.
- A duplicate section name, or a non-blank, non-comment line that is neither a section header nor
  contains `=`, throws an `Error` whose message contains the 1-based line number.

API:
- `loadPresets(path: string): Record<string, Record<string, string>>`: preset name -> merged keys
  (all values strings), in file order.
- `main(argv: string[], out = console.log): number`, where `argv` holds the arguments after the
  script name (`node src/presets.ts FILE` gives `["FILE"]`). It calls `out` once per preset with
  `<name> ctx=<ctx-size or '-'> devices=<device or '-'> split=<split-mode, default 'layer'> draft=<yes|no>`,
  where draft is `yes` if the preset has a `spec-draft-model` key, and returns 0.
