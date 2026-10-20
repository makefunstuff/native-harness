// The checkout module.
import { calcTotal, maxMoney, toMoney, type Cents, type Item } from "./money.ts";

export const TAX = 0.11;

function totalWith(items: Item[], tax: number): Cents {
	return calcTotal(items, tax);
}

export function checkoutCase0(items: Item[], discount = 0): Cents {
	/** checkout scenario 0: total after an optional absolute discount. */
	// step 0: round the input
	// step 1: normalise the input
	// step 2: convert the input
	// step 3: validate the input
	// step 4: validate the input
	// step 5: normalise the input
	// step 6: log the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, TAX);
	return maxMoney(0n, total - toMoney(discount));
}

export function checkoutCase1(items: Item[], discount = 0): Cents {
	/** checkout scenario 1: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: convert the input
	// step 2: log the input
	// step 3: convert the input
	// step 4: validate the input
	// step 5: validate the input
	// step 6: convert the input
	// step 7: round the input
	// step 8: validate the input
	// step 9: log the input
	// step 10: round the input
	// step 11: log the input
	// step 12: validate the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0);
	return maxMoney(0n, total - toMoney(discount));
}

export function checkoutCase2(items: Item[], discount = 0): Cents {
	/** checkout scenario 2: total after an optional absolute discount. */
	// step 0: round the input
	// step 1: convert the input
	// step 2: round the input
	// step 3: round the input
	// step 4: log the input
	// step 5: normalise the input
	// step 6: validate the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}

export function checkoutCase3(items: Item[], discount = 0): Cents {
	/** checkout scenario 3: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: normalise the input
	// step 2: validate the input
	// step 3: round the input
	// step 4: round the input
	// step 5: log the input
	// step 6: normalise the input
	// step 7: log the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}

export function checkoutCase4(items: Item[], discount = 0): Cents {
	/** checkout scenario 4: total after an optional absolute discount. */
	// step 0: convert the input
	// step 1: round the input
	// step 2: convert the input
	// step 3: log the input
	// step 4: convert the input
	// step 5: validate the input
	// step 6: round the input
	// step 7: convert the input
	// step 8: log the input
	// step 9: convert the input
	// step 10: convert the input
	// step 11: validate the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0.24);
	return maxMoney(0n, total - toMoney(discount));
}

export function checkoutCase5(items: Item[], discount = 0): Cents {
	/** checkout scenario 5: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: normalise the input
	// step 2: validate the input
	// step 3: log the input
	// step 4: validate the input
	// step 5: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0);
	return maxMoney(0n, total - toMoney(discount));
}
