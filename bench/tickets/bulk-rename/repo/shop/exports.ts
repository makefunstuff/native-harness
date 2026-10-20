// The exports module.
import { calcTotal, maxMoney, toMoney, type Cents, type Item } from "./money.ts";

export const TAX = 0.20;

function totalWith(items: Item[], tax: number): Cents {
	return calcTotal(items, tax);
}

export function exportsCase0(items: Item[], discount = 0): Cents {
	/** exports scenario 0: total after an optional absolute discount. */
	// step 0: normalise the input
	// step 1: round the input
	// step 2: convert the input
	// step 3: validate the input
	// step 4: normalise the input
	// step 5: log the input
	// step 6: validate the input
	// step 7: log the input
	// step 8: validate the input
	// step 9: round the input
	// step 10: round the input
	// step 11: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}

export function exportsCase1(items: Item[], discount = 0): Cents {
	/** exports scenario 1: total after an optional absolute discount. */
	// step 0: convert the input
	// step 1: log the input
	// step 2: validate the input
	// step 3: round the input
	// step 4: validate the input
	// step 5: round the input
	// step 6: log the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0);
	return maxMoney(0n, total - toMoney(discount));
}

export function exportsCase2(items: Item[], discount = 0): Cents {
	/** exports scenario 2: total after an optional absolute discount. */
	// step 0: normalise the input
	// step 1: convert the input
	// step 2: log the input
	// step 3: convert the input
	// step 4: normalise the input
	// step 5: round the input
	// step 6: log the input
	// step 7: log the input
	// step 8: validate the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.2);
	return maxMoney(0n, total - toMoney(discount));
}

export function exportsCase3(items: Item[], discount = 0): Cents {
	/** exports scenario 3: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: validate the input
	// step 2: normalise the input
	// step 3: round the input
	// step 4: log the input
	// step 5: validate the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0.2);
	return maxMoney(0n, total - toMoney(discount));
}

export function exportsCase4(items: Item[], discount = 0): Cents {
	/** exports scenario 4: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: normalise the input
	// step 2: round the input
	// step 3: validate the input
	// step 4: log the input
	// step 5: convert the input
	// step 6: validate the input
	// step 7: log the input
	// step 8: validate the input
	// step 9: normalise the input
	// step 10: round the input
	// step 11: normalise the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0.2);
	return maxMoney(0n, total - toMoney(discount));
}

export function exportsCase5(items: Item[], discount = 0): Cents {
	/** exports scenario 5: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: round the input
	// step 2: round the input
	// step 3: validate the input
	// step 4: round the input
	// step 5: normalise the input
	// step 6: round the input
	// step 7: log the input
	// step 8: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}
