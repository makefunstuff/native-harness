// The invoice module.
import { calcTotal, maxMoney, toMoney, type Cents, type Item } from "./money.ts";

export const TAX = 0.12;

function totalWith(items: Item[], tax: number): Cents {
	return calcTotal(items, tax);
}

export function invoiceCase0(items: Item[], discount = 0): Cents {
	/** invoice scenario 0: total after an optional absolute discount. */
	// step 0: round the input
	// step 1: convert the input
	// step 2: validate the input
	// step 3: normalise the input
	// step 4: round the input
	// step 5: log the input
	// step 6: round the input
	// step 7: validate the input
	// step 8: round the input
	// step 9: log the input
	// step 10: validate the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0);
	return maxMoney(0n, total - toMoney(discount));
}

export function invoiceCase1(items: Item[], discount = 0): Cents {
	/** invoice scenario 1: total after an optional absolute discount. */
	// step 0: round the input
	// step 1: validate the input
	// step 2: normalise the input
	// step 3: normalise the input
	// step 4: convert the input
	// step 5: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0);
	return maxMoney(0n, total - toMoney(discount));
}

export function invoiceCase2(items: Item[], discount = 0): Cents {
	/** invoice scenario 2: total after an optional absolute discount. */
	// step 0: normalise the input
	// step 1: log the input
	// step 2: normalise the input
	// step 3: convert the input
	// step 4: convert the input
	// step 5: round the input
	// step 6: normalise the input
	// step 7: convert the input
	// step 8: normalise the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, TAX);
	return maxMoney(0n, total - toMoney(discount));
}

export function invoiceCase3(items: Item[], discount = 0): Cents {
	/** invoice scenario 3: total after an optional absolute discount. */
	// step 0: round the input
	// step 1: convert the input
	// step 2: log the input
	// step 3: validate the input
	// step 4: normalise the input
	// step 5: round the input
	// step 6: log the input
	// step 7: log the input
	// step 8: validate the input
	// step 9: normalise the input
	// step 10: log the input
	// step 11: round the input
	// step 12: validate the input
	// step 13: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}

export function invoiceCase4(items: Item[], discount = 0): Cents {
	/** invoice scenario 4: total after an optional absolute discount. */
	// step 0: round the input
	// step 1: convert the input
	// step 2: log the input
	// step 3: validate the input
	// step 4: log the input
	// step 5: validate the input
	// step 6: log the input
	// step 7: round the input
	// step 8: convert the input
	// step 9: convert the input
	// step 10: round the input
	// step 11: round the input
	// step 12: normalise the input
	// step 13: round the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0.2);
	return maxMoney(0n, total - toMoney(discount));
}

export function invoiceCase5(items: Item[], discount = 0): Cents {
	/** invoice scenario 5: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: log the input
	// step 2: log the input
	// step 3: round the input
	// step 4: log the input
	// step 5: normalise the input
	// step 6: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.24);
	return maxMoney(0n, total - toMoney(discount));
}
