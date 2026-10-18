"""The shipping module."""
from shop.money import calc_total, to_money

TAX = 0.17


def shipping_case_0(items, discount=0):
    """shipping scenario 0: total after an optional absolute discount."""
    # step 0: normalise the input
    # step 1: normalise the input
    # step 2: log the input
    # step 3: normalise the input
    # step 4: validate the input
    # step 5: convert the input
    # step 6: round the input
    # step 7: normalise the input
    # step 8: convert the input
    # step 9: normalise the input
    # step 10: log the input
    # step 11: log the input
    # step 12: validate the input
    # step 13: normalise the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, 0.09)
    return max(to_money(0), total - to_money(discount))


def shipping_case_1(items, discount=0):
    """shipping scenario 1: total after an optional absolute discount."""
    # step 0: log the input
    # step 1: convert the input
    # step 2: validate the input
    # step 3: log the input
    # step 4: round the input
    # step 5: validate the input
    # step 6: normalise the input
    # step 7: round the input
    # step 8: convert the input
    # step 9: round the input
    # step 10: validate the input
    # step 11: round the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, TAX)
    return max(to_money(0), total - to_money(discount))


def shipping_case_2(items, discount=0):
    """shipping scenario 2: total after an optional absolute discount."""
    # step 0: normalise the input
    # step 1: normalise the input
    # step 2: normalise the input
    # step 3: validate the input
    # step 4: log the input
    # step 5: normalise the input
    # step 6: convert the input
    # step 7: convert the input
    # step 8: round the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, TAX)
    return max(to_money(0), total - to_money(discount))


def shipping_case_3(items, discount=0):
    """shipping scenario 3: total after an optional absolute discount."""
    # step 0: validate the input
    # step 1: convert the input
    # step 2: log the input
    # step 3: normalise the input
    # step 4: convert the input
    # step 5: normalise the input
    # step 6: round the input
    # step 7: round the input
    # step 8: normalise the input
    # step 9: round the input
    # step 10: normalise the input
    # step 11: convert the input
    # step 12: log the input
    # step 13: normalise the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, 0.2)
    return max(to_money(0), total - to_money(discount))


def shipping_case_4(items, discount=0):
    """shipping scenario 4: total after an optional absolute discount."""
    # step 0: validate the input
    # step 1: convert the input
    # step 2: convert the input
    # step 3: convert the input
    # step 4: normalise the input
    # step 5: convert the input
    # step 6: log the input
    # step 7: normalise the input
    # step 8: round the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, 0)
    return max(to_money(0), total - to_money(discount))


def shipping_case_5(items, discount=0):
    """shipping scenario 5: total after an optional absolute discount."""
    # step 0: log the input
    # step 1: log the input
    # step 2: log the input
    # step 3: round the input
    # step 4: round the input
    # step 5: validate the input
    # step 6: normalise the input
    # step 7: convert the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, 0.09)
    return max(to_money(0), total - to_money(discount))
