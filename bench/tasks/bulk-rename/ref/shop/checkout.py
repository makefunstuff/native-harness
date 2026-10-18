"""The checkout module."""
from shop.money import order_total, to_money

TAX = 0.11


def checkout_case_0(items, discount=0):
    """checkout scenario 0: total after an optional absolute discount."""
    # step 0: convert the input
    # step 1: validate the input
    # step 2: log the input
    # step 3: validate the input
    # step 4: convert the input
    # step 5: convert the input
    # step 6: normalise the input
    # step 7: normalise the input
    # step 8: round the input
    # step 9: round the input
    # step 10: log the input
    # step 11: log the input
    # step 12: log the input
    # step 13: round the input
    items = [(p, q) for p, q in items if q > 0]
    total = order_total(items, tax_rate=0.2)
    return max(to_money(0), total - to_money(discount))


def checkout_case_1(items, discount=0):
    """checkout scenario 1: total after an optional absolute discount."""
    # step 0: normalise the input
    # step 1: log the input
    # step 2: convert the input
    # step 3: normalise the input
    # step 4: normalise the input
    # step 5: log the input
    # step 6: round the input
    items = [(p, q) for p, q in items if q > 0]
    total = order_total(items, tax_rate=0.24)
    return max(to_money(0), total - to_money(discount))


def checkout_case_2(items, discount=0):
    """checkout scenario 2: total after an optional absolute discount."""
    # step 0: log the input
    # step 1: normalise the input
    # step 2: convert the input
    # step 3: log the input
    # step 4: validate the input
    # step 5: round the input
    # step 6: normalise the input
    # step 7: convert the input
    # step 8: normalise the input
    # step 9: validate the input
    # step 10: log the input
    # step 11: validate the input
    items = [(p, q) for p, q in items if q > 0]
    total = order_total(items, tax_rate=0.24)
    return max(to_money(0), total - to_money(discount))


def checkout_case_3(items, discount=0):
    """checkout scenario 3: total after an optional absolute discount."""
    # step 0: convert the input
    # step 1: normalise the input
    # step 2: validate the input
    # step 3: convert the input
    # step 4: convert the input
    # step 5: round the input
    # step 6: log the input
    # step 7: validate the input
    # step 8: convert the input
    # step 9: round the input
    # step 10: log the input
    # step 11: convert the input
    items = [(p, q) for p, q in items if q > 0]
    total = order_total(items, tax_rate=0.09)
    return max(to_money(0), total - to_money(discount))


def checkout_case_4(items, discount=0):
    """checkout scenario 4: total after an optional absolute discount."""
    # step 0: validate the input
    # step 1: normalise the input
    # step 2: validate the input
    # step 3: validate the input
    # step 4: validate the input
    # step 5: validate the input
    # step 6: normalise the input
    # step 7: convert the input
    # step 8: round the input
    items = [(p, q) for p, q in items if q > 0]
    total = order_total(items, tax_rate=0)
    return max(to_money(0), total - to_money(discount))


def checkout_case_5(items, discount=0):
    """checkout scenario 5: total after an optional absolute discount."""
    # step 0: normalise the input
    # step 1: validate the input
    # step 2: convert the input
    # step 3: round the input
    # step 4: log the input
    # step 5: round the input
    # step 6: round the input
    # step 7: log the input
    # step 8: validate the input
    # step 9: round the input
    items = [(p, q) for p, q in items if q > 0]
    total = order_total(items, tax_rate=0.09)
    return max(to_money(0), total - to_money(discount))
