// The reports module.
import { maxMoney, orderTotal, toMoney, type Cents, type Item } from "./money.ts";

export const TAX = 0.14;

function totalWith(items: Item[], tax: number): Cents {
	return orderTotal(items, { taxRate: tax });
}

export function reportsCase0(items: Item[], discount = 0): Cents {
	/** reports scenario 0: total after an optional absolute discount. */
	// step 0: validate the input
	// step 1: log the input
	// step 2: log the input
	// step 3: normalise the input
	// step 4: round the input
	// step 5: log the input
	// step 6: round the input
	// step 7: round the input
	// step 8: round the input
	// step 9: validate the input
	// step 10: log the input
	// step 11: validate the input
	// step 12: validate the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.2);
	return maxMoney(0n, total - toMoney(discount));
}

export function reportsCase1(items: Item[], discount = 0): Cents {
	/** reports scenario 1: total after an optional absolute discount. */
	// step 0: validate the input
	// step 1: round the input
	// step 2: normalise the input
	// step 3: round the input
	// step 4: round the input
	// step 5: log the input
	// step 6: validate the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0.2 });
	return maxMoney(0n, total - toMoney(discount));
}

export function reportsCase2(items: Item[], discount = 0): Cents {
	/** reports scenario 2: total after an optional absolute discount. */
	// step 0: validate the input
	// step 1: validate the input
	// step 2: log the input
	// step 3: normalise the input
	// step 4: round the input
	// step 5: normalise the input
	// step 6: convert the input
	// step 7: log the input
	// step 8: convert the input
	// step 9: convert the input
	// step 10: validate the input
	// step 11: validate the input
	// step 12: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}

export function reportsCase3(items: Item[], discount = 0): Cents {
	/** reports scenario 3: total after an optional absolute discount. */
	// step 0: validate the input
	// step 1: normalise the input
	// step 2: convert the input
	// step 3: convert the input
	// step 4: convert the input
	// step 5: normalise the input
	// step 6: convert the input
	// step 7: validate the input
	// step 8: log the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}

export function reportsCase4(items: Item[], discount = 0): Cents {
	/** reports scenario 4: total after an optional absolute discount. */
	// step 0: convert the input
	// step 1: log the input
	// step 2: validate the input
	// step 3: round the input
	// step 4: log the input
	// step 5: log the input
	// step 6: log the input
	// step 7: log the input
	// step 8: round the input
	// step 9: log the input
	// step 10: validate the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0.09 });
	return maxMoney(0n, total - toMoney(discount));
}

export function reportsCase5(items: Item[], discount = 0): Cents {
	/** reports scenario 5: total after an optional absolute discount. */
	// step 0: normalise the input
	// step 1: log the input
	// step 2: validate the input
	// step 3: normalise the input
	// step 4: log the input
	// step 5: round the input
	// step 6: log the input
	// step 7: log the input
	// step 8: convert the input
	// step 9: convert the input
	// step 10: log the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0.24 });
	return maxMoney(0n, total - toMoney(discount));
}
