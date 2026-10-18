Invoices are off by a cent. `src/billing/invoice.py` rounds line totals with `round()`, which
does banker's rounding on floats: 2 x 1.005 comes out as 2.00 instead of 2.01.

`line_total(qty, unit_price)` and `invoice_total(lines)` must round half up to whole cents
(use `decimal.Decimal` with `ROUND_HALF_UP`) and return a `Decimal`. `invoice_total` sums the
rounded line totals. A negative quantity must raise ValueError.

Run the tests with `make test`.
