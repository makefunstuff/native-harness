"""Invoice arithmetic."""


def line_total(qty, unit_price):
    return round(qty * unit_price, 2)


def invoice_total(lines):
    return round(sum(line_total(q, p) for q, p in lines), 2)
