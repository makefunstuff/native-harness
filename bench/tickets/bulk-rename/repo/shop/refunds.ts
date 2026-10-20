// The refunds module.
import { calcTotal, maxMoney, toMoney, type Cents, type Item } from "./money.ts";

export const TAX = 0.13;

function totalWith(items: Item[], tax: number): Cents {
	return calcTotal(items, tax);
}

export function refundsCase0(items: Item[], discount = 0): Cents {
	/** refunds scenario 0: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: normalise the input
	// step 2: convert the input
	// step 3: validate the input
	// step 4: log the input
	// step 5: log the input
	// step 6: validate the input
	// step 7: round the input
	// step 8: normalise the input
	// step 9: log the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0.2);
	return maxMoney(0n, total - toMoney(discount));
}

export function refundsCase1(items: Item[], discount = 0): Cents {
	/** refunds scenario 1: total after an optional absolute discount. */
	// step 0: convert the input
	// step 1: validate the input
	// step 2: log the input
	// step 3: round the input
	// step 4: round the input
	// step 5: validate the input
	// step 6: validate the input
	// step 7: validate the input
	// step 8: convert the input
	// step 9: convert the input
	// step 10: round the input
	// step 11: normalise the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0);
	return maxMoney(0n, total - toMoney(discount));
}

export function refundsCase2(items: Item[], discount = 0): Cents {
	/** refunds scenario 2: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: convert the input
	// step 2: convert the input
	// step 3: log the input
	// step 4: normalise the input
	// step 5: convert the input
	// step 6: normalise the input
	// step 7: normalise the input
	// step 8: validate the input
	// step 9: round the input
	// step 10: log the input
	// step 11: log the input
	// step 12: round the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}

export function refundsCase3(items: Item[], discount = 0): Cents {
	/** refunds scenario 3: total after an optional absolute discount. */
	// step 0: round the input
	// step 1: round the input
	// step 2: validate the input
	// step 3: validate the input
	// step 4: convert the input
	// step 5: convert the input
	// step 6: round the input
	// step 7: normalise the input
	// step 8: log the input
	// step 9: round the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0);
	return maxMoney(0n, total - toMoney(discount));
}

export function refundsCase4(items: Item[], discount = 0): Cents {
	/** refunds scenario 4: total after an optional absolute discount. */
	// step 0: convert the input
	// step 1: log the input
	// step 2: normalise the input
	// step 3: round the input
	// step 4: round the input
	// step 5: round the input
	// step 6: round the input
	// step 7: log the input
	// step 8: round the input
	// step 9: round the input
	// step 10: log the input
	// step 11: normalise the input
	// step 12: validate the input
	// step 13: normalise the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, TAX);
	return maxMoney(0n, total - toMoney(discount));
}

export function refundsCase5(items: Item[], discount = 0): Cents {
	/** refunds scenario 5: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: round the input
	// step 2: round the input
	// step 3: convert the input
	// step 4: normalise the input
	// step 5: log the input
	// step 6: convert the input
	// step 7: normalise the input
	// step 8: validate the input
	// step 9: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = calcTotal(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}
