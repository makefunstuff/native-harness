Feature request for `inventory.py` (a small CLI that reports stock from a CSV file):

- Add `--format {table,json}` (default `table`, the current output).
- `--format json` prints a JSON array of objects with keys `name` (str), `qty` (int) and
  `price` (float), sorted by name, and nothing else on stdout.
- The existing `--min-qty N` filter must apply to both formats.
- An unknown format must make the program exit with status 2 (argparse's usual usage
  error).
- Rows whose `qty` or `price` cannot be parsed are skipped, with one warning line per
  skipped row on stderr (`skipping row N: ...`, N = 1-based data row number), in both formats.
- Update the README's usage section.
`main(argv)` must stay importable and return the exit code for normal runs.
Run the tests with: python3 -m unittest discover -s tests
