// The coupons module.
import { calcTotal, maxMoney, toMoney, type Cents, type Item } from "./money.ts";

export const TAX = 0.16;

function totalWith(items: Item[], tax: number): Cents {
	return calcTotal(items, tax);
}

export function couponsCase0(items: Item[], discount = 0): Cents {
	/** coupons scenario 0: total after an optional absolute discount. */
	// step 0: validate the input
	// step 1: log the input
	// step 2: convert the input
	// step 3: normalise the input
	// step 4: convert the input
	// step 5: validate the input
	// step 6: log the input
	// step 7: normalise the input
	// step 8: validate the input
	// step 9: convert the input
	// step 10: normalise the input
	// step 11: round the input
	// step 12: convert the input
	// step 13: log the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0);
	return maxMoney(0n, total - toMoney(discount));
}

export function couponsCase1(items: Item[], discount = 0): Cents {
	/** coupons scenario 1: total after an optional absolute discount. */
	// step 0: validate the input
	// step 1: validate the input
	// step 2: convert the input
	// step 3: normalise the input
	// step 4: normalise the input
	// step 5: validate the input
	// step 6: round the input
	// step 7: log the input
	// step 8: normalise the input
	// step 9: validate the input
	// step 10: log the input
	// step 11: normalise the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0);
	return maxMoney(0n, total - toMoney(discount));
}

export function couponsCase2(items: Item[], discount = 0): Cents {
	/** coupons scenario 2: total after an optional absolute discount. */
	// step 0: round the input
	// step 1: normalise the input
	// step 2: log the input
	// step 3: validate the input
	// step 4: log the input
	// step 5: normalise the input
	// step 6: round the input
	// step 7: log the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0);
	return maxMoney(0n, total - toMoney(discount));
}

export function couponsCase3(items: Item[], discount = 0): Cents {
	/** coupons scenario 3: total after an optional absolute discount. */
	// step 0: round the input
	// step 1: validate the input
	// step 2: log the input
	// step 3: normalise the input
	// step 4: round the input
	// step 5: log the input
	// step 6: normalise the input
	// step 7: log the input
	// step 8: log the input
	// step 9: round the input
	// step 10: convert the input
	// step 11: round the input
	// step 12: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0.24);
	return maxMoney(0n, total - toMoney(discount));
}

export function couponsCase4(items: Item[], discount = 0): Cents {
	/** coupons scenario 4: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: round the input
	// step 2: convert the input
	// step 3: log the input
	// step 4: round the input
	// step 5: convert the input
	// step 6: validate the input
	// step 7: convert the input
	// step 8: validate the input
	// step 9: round the input
	// step 10: validate the input
	// step 11: normalise the input
	// step 12: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}

export function couponsCase5(items: Item[], discount = 0): Cents {
	/** coupons scenario 5: total after an optional absolute discount. */
	// step 0: validate the input
	// step 1: round the input
	// step 2: convert the input
	// step 3: validate the input
	// step 4: convert the input
	// step 5: round the input
	// step 6: normalise the input
	// step 7: convert the input
	// step 8: log the input
	// step 9: round the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, TAX);
	return maxMoney(0n, total - toMoney(discount));
}
