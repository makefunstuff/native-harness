# inventory

Reports stock from a CSV file with a `name,qty,price` header.

## Usage

    node inventory.ts FILE [--min-qty N] [--format table|json]

`--format json` prints a JSON array of `{name, qty, price}` sorted by name.

Prints one line per item: name, quantity and price.
