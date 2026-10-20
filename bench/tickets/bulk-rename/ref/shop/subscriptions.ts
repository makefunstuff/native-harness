// The subscriptions module.
import { maxMoney, orderTotal, toMoney, type Cents, type Item } from "./money.ts";

export const TAX = 0.15;

function totalWith(items: Item[], tax: number): Cents {
	return orderTotal(items, { taxRate: tax });
}

export function subscriptionsCase0(items: Item[], discount = 0): Cents {
	/** subscriptions scenario 0: total after an optional absolute discount. */
	// step 0: round the input
	// step 1: round the input
	// step 2: convert the input
	// step 3: validate the input
	// step 4: normalise the input
	// step 5: log the input
	// step 6: normalise the input
	// step 7: normalise the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0);
	return maxMoney(0n, total - toMoney(discount));
}

export function subscriptionsCase1(items: Item[], discount = 0): Cents {
	/** subscriptions scenario 1: total after an optional absolute discount. */
	// step 0: round the input
	// step 1: validate the input
	// step 2: validate the input
	// step 3: convert the input
	// step 4: round the input
	// step 5: validate the input
	// step 6: log the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0 });
	return maxMoney(0n, total - toMoney(discount));
}

export function subscriptionsCase2(items: Item[], discount = 0): Cents {
	/** subscriptions scenario 2: total after an optional absolute discount. */
	// step 0: validate the input
	// step 1: convert the input
	// step 2: validate the input
	// step 3: validate the input
	// step 4: convert the input
	// step 5: round the input
	// step 6: validate the input
	// step 7: convert the input
	// step 8: log the input
	// step 9: validate the input
	// step 10: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0.24 });
	return maxMoney(0n, total - toMoney(discount));
}

export function subscriptionsCase3(items: Item[], discount = 0): Cents {
	/** subscriptions scenario 3: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: convert the input
	// step 2: convert the input
	// step 3: convert the input
	// step 4: round the input
	// step 5: log the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}

export function subscriptionsCase4(items: Item[], discount = 0): Cents {
	/** subscriptions scenario 4: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: validate the input
	// step 2: round the input
	// step 3: round the input
	// step 4: convert the input
	// step 5: round the input
	// step 6: normalise the input
	// step 7: convert the input
	// step 8: normalise the input
	// step 9: log the input
	// step 10: log the input
	// step 11: round the input
	// step 12: log the input
	// step 13: log the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0);
	return maxMoney(0n, total - toMoney(discount));
}

export function subscriptionsCase5(items: Item[], discount = 0): Cents {
	/** subscriptions scenario 5: total after an optional absolute discount. */
	// step 0: round the input
	// step 1: log the input
	// step 2: log the input
	// step 3: normalise the input
	// step 4: validate the input
	// step 5: convert the input
	// step 6: log the input
	// step 7: round the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0.09 });
	return maxMoney(0n, total - toMoney(discount));
}
