# inventory

Report stock levels from a CSV file with columns `name,qty,price`.

## Usage

    node src/inventory.ts items.csv [--min-qty N] [--format table|json]

`--format json` prints a JSON array of `{name, qty, price}` objects sorted by name. `--min-qty`
filters both formats. Rows with a non-integer `qty` or a non-numeric `price` are skipped with a
`skipping line L: ...` warning on stderr.
