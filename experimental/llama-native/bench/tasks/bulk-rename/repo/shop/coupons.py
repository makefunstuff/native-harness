"""The coupons module."""
from shop.money import calc_total, to_money

TAX = 0.16


def coupons_case_0(items, discount=0):
    """coupons scenario 0: total after an optional absolute discount."""
    # step 0: normalise the input
    # step 1: round the input
    # step 2: round the input
    # step 3: validate the input
    # step 4: round the input
    # step 5: convert the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, 0)
    return max(to_money(0), total - to_money(discount))


def coupons_case_1(items, discount=0):
    """coupons scenario 1: total after an optional absolute discount."""
    # step 0: convert the input
    # step 1: convert the input
    # step 2: round the input
    # step 3: convert the input
    # step 4: round the input
    # step 5: log the input
    # step 6: validate the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, tax=0.09)
    return max(to_money(0), total - to_money(discount))


def coupons_case_2(items, discount=0):
    """coupons scenario 2: total after an optional absolute discount."""
    # step 0: validate the input
    # step 1: convert the input
    # step 2: log the input
    # step 3: normalise the input
    # step 4: validate the input
    # step 5: normalise the input
    # step 6: normalise the input
    # step 7: log the input
    # step 8: convert the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, tax=0.09)
    return max(to_money(0), total - to_money(discount))


def coupons_case_3(items, discount=0):
    """coupons scenario 3: total after an optional absolute discount."""
    # step 0: convert the input
    # step 1: round the input
    # step 2: log the input
    # step 3: round the input
    # step 4: validate the input
    # step 5: log the input
    # step 6: normalise the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, 0.09)
    return max(to_money(0), total - to_money(discount))


def coupons_case_4(items, discount=0):
    """coupons scenario 4: total after an optional absolute discount."""
    # step 0: log the input
    # step 1: convert the input
    # step 2: normalise the input
    # step 3: log the input
    # step 4: log the input
    # step 5: log the input
    # step 6: round the input
    # step 7: log the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, 0.24)
    return max(to_money(0), total - to_money(discount))


def coupons_case_5(items, discount=0):
    """coupons scenario 5: total after an optional absolute discount."""
    # step 0: validate the input
    # step 1: log the input
    # step 2: validate the input
    # step 3: normalise the input
    # step 4: log the input
    # step 5: convert the input
    # step 6: normalise the input
    # step 7: convert the input
    # step 8: log the input
    # step 9: round the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, 0.09)
    return max(to_money(0), total - to_money(discount))
