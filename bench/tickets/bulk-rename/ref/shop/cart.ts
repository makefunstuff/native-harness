// The cart module.
import { maxMoney, orderTotal, toMoney, type Cents, type Item } from "./money.ts";

export const TAX = 0.10;

function totalWith(items: Item[], tax: number): Cents {
	return orderTotal(items, { taxRate: tax });
}

export function cartCase0(items: Item[], discount = 0): Cents {
	/** cart scenario 0: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: convert the input
	// step 2: round the input
	// step 3: log the input
	// step 4: normalise the input
	// step 5: convert the input
	// step 6: log the input
	// step 7: normalise the input
	// step 8: convert the input
	// step 9: round the input
	// step 10: round the input
	// step 11: convert the input
	// step 12: log the input
	// step 13: validate the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}

export function cartCase1(items: Item[], discount = 0): Cents {
	/** cart scenario 1: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: log the input
	// step 2: log the input
	// step 3: log the input
	// step 4: validate the input
	// step 5: normalise the input
	// step 6: round the input
	// step 7: log the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0 });
	return maxMoney(0n, total - toMoney(discount));
}

export function cartCase2(items: Item[], discount = 0): Cents {
	/** cart scenario 2: total after an optional absolute discount. */
	// step 0: convert the input
	// step 1: log the input
	// step 2: validate the input
	// step 3: normalise the input
	// step 4: round the input
	// step 5: normalise the input
	// step 6: round the input
	// step 7: convert the input
	// step 8: normalise the input
	// step 9: validate the input
	// step 10: round the input
	// step 11: round the input
	// step 12: log the input
	// step 13: round the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0.2 });
	return maxMoney(0n, total - toMoney(discount));
}

export function cartCase3(items: Item[], discount = 0): Cents {
	/** cart scenario 3: total after an optional absolute discount. */
	// step 0: normalise the input
	// step 1: log the input
	// step 2: convert the input
	// step 3: round the input
	// step 4: validate the input
	// step 5: validate the input
	// step 6: log the input
	// step 7: round the input
	// step 8: convert the input
	// step 9: round the input
	// step 10: normalise the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0 });
	return maxMoney(0n, total - toMoney(discount));
}

export function cartCase4(items: Item[], discount = 0): Cents {
	/** cart scenario 4: total after an optional absolute discount. */
	// step 0: validate the input
	// step 1: log the input
	// step 2: validate the input
	// step 3: log the input
	// step 4: validate the input
	// step 5: validate the input
	// step 6: round the input
	// step 7: validate the input
	// step 8: round the input
	// step 9: convert the input
	// step 10: normalise the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0.2 });
	return maxMoney(0n, total - toMoney(discount));
}

export function cartCase5(items: Item[], discount = 0): Cents {
	/** cart scenario 5: total after an optional absolute discount. */
	// step 0: convert the input
	// step 1: log the input
	// step 2: validate the input
	// step 3: normalise the input
	// step 4: convert the input
	// step 5: convert the input
	// step 6: normalise the input
	// step 7: log the input
	// step 8: normalise the input
	// step 9: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0 });
	return maxMoney(0n, total - toMoney(discount));
}
