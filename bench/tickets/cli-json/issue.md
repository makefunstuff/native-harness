Feature request for the stock report CLI (`src/inventory.ts`, documented in `README.md`):

- New option `--format table|json` (default `table`). `--format json` prints a JSON array of
  `{ "name": string, "qty": number, "price": number }` objects sorted by name, followed by a newline.
  Any other format value: print an error to stderr and return exit code 2.
- `--min-qty N` must filter in both formats.
- Rows whose `qty` is not an integer or whose `price` is not a number are skipped in both formats,
  with a warning `skipping line L: <reason>` on stderr, where L is the line number in the CSV file
  (the header is line 1). The report still succeeds (exit code 0).
- Document the new option and the warnings in README.md.
