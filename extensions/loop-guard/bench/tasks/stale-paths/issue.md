Invoices are off by a cent. `src/billing/invoice.ts` multiplies floats: one item at "1.005"
comes out as 100 cents instead of 101.

`lineTotal(qty, unitPrice)` takes the unit price as a decimal string ("1.005", "12", "0.3333")
and must return integer cents, rounded half up on the exact decimal value (1 x "1.005" = 101,
3 x "0.3333" = 100, 1 x "0.125" = 13). `invoiceTotal(lines)` sums the rounded line totals.
A quantity that is negative or not an integer, or a price that is not a plain non-negative
decimal number, must throw a RangeError.

Run the tests with `make test`.
