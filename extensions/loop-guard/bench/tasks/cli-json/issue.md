Feature request for `inventory.ts`, a small CLI that reports stock from a CSV file
(`node inventory.ts stock.csv [--min-qty N]`):

- Add `--format table|json` (default `table`, the current output).
- `--format json` prints a JSON array of objects with keys `name` (string), `qty` (integer)
  and `price` (number), sorted by name, and nothing else on stdout.
- The existing `--min-qty N` filter must apply to both formats.
- An unknown format must print a usage error on stderr and exit with status 2.
- Rows whose `qty` or `price` cannot be parsed are skipped, with one warning line per skipped
  row on stderr (`skipping row N: ...`, N = 1-based data row number), in both formats.
- Update the README's usage section.
`main(argv, io)` must stay exported and return the exit code.
Run the tests with: node --test tests/*.spec.ts
