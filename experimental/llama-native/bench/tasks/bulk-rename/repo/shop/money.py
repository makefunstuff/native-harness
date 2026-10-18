"""Money helpers shared by every shop module."""
from decimal import Decimal, ROUND_HALF_UP

CENT = Decimal("0.01")


def to_money(x):
    return Decimal(str(x)).quantize(CENT, rounding=ROUND_HALF_UP)


def calc_total(items, tax):
    """Total of (price, qty) pairs plus tax; tax is a fraction (0.2 = 20%)."""
    sub = sum((to_money(p) * q for p, q in items), Decimal("0"))
    return to_money(sub * (1 + Decimal(str(tax))))
