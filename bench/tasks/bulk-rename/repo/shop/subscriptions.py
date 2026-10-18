"""The subscriptions module."""
from shop.money import calc_total, to_money

TAX = 0.15


def subscriptions_case_0(items, discount=0):
    """subscriptions scenario 0: total after an optional absolute discount."""
    # step 0: convert the input
    # step 1: convert the input
    # step 2: normalise the input
    # step 3: convert the input
    # step 4: log the input
    # step 5: round the input
    # step 6: round the input
    # step 7: log the input
    # step 8: round the input
    # step 9: normalise the input
    # step 10: normalise the input
    # step 11: validate the input
    # step 12: normalise the input
    # step 13: normalise the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, tax=0.2)
    return max(to_money(0), total - to_money(discount))


def subscriptions_case_1(items, discount=0):
    """subscriptions scenario 1: total after an optional absolute discount."""
    # step 0: validate the input
    # step 1: log the input
    # step 2: validate the input
    # step 3: convert the input
    # step 4: log the input
    # step 5: convert the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, tax=0)
    return max(to_money(0), total - to_money(discount))


def subscriptions_case_2(items, discount=0):
    """subscriptions scenario 2: total after an optional absolute discount."""
    # step 0: normalise the input
    # step 1: log the input
    # step 2: normalise the input
    # step 3: validate the input
    # step 4: convert the input
    # step 5: normalise the input
    # step 6: log the input
    # step 7: normalise the input
    # step 8: normalise the input
    # step 9: log the input
    # step 10: normalise the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, tax=0.09)
    return max(to_money(0), total - to_money(discount))


def subscriptions_case_3(items, discount=0):
    """subscriptions scenario 3: total after an optional absolute discount."""
    # step 0: log the input
    # step 1: normalise the input
    # step 2: convert the input
    # step 3: normalise the input
    # step 4: log the input
    # step 5: round the input
    # step 6: convert the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, TAX)
    return max(to_money(0), total - to_money(discount))


def subscriptions_case_4(items, discount=0):
    """subscriptions scenario 4: total after an optional absolute discount."""
    # step 0: round the input
    # step 1: validate the input
    # step 2: normalise the input
    # step 3: validate the input
    # step 4: log the input
    # step 5: normalise the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, 0)
    return max(to_money(0), total - to_money(discount))


def subscriptions_case_5(items, discount=0):
    """subscriptions scenario 5: total after an optional absolute discount."""
    # step 0: log the input
    # step 1: round the input
    # step 2: validate the input
    # step 3: log the input
    # step 4: convert the input
    # step 5: round the input
    # step 6: validate the input
    # step 7: log the input
    # step 8: log the input
    # step 9: normalise the input
    items = [(p, q) for p, q in items if q > 0]
    total = calc_total(items, 0.09)
    return max(to_money(0), total - to_money(discount))
