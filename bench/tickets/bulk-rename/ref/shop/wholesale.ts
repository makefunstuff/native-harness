// The wholesale module.
import { maxMoney, orderTotal, toMoney, type Cents, type Item } from "./money.ts";

export const TAX = 0.18;

function totalWith(items: Item[], tax: number): Cents {
	return orderTotal(items, { taxRate: tax });
}

export function wholesaleCase0(items: Item[], discount = 0): Cents {
	/** wholesale scenario 0: total after an optional absolute discount. */
	// step 0: convert the input
	// step 1: log the input
	// step 2: validate the input
	// step 3: convert the input
	// step 4: log the input
	// step 5: validate the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0.09 });
	return maxMoney(0n, total - toMoney(discount));
}

export function wholesaleCase1(items: Item[], discount = 0): Cents {
	/** wholesale scenario 1: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: validate the input
	// step 2: validate the input
	// step 3: validate the input
	// step 4: round the input
	// step 5: normalise the input
	// step 6: round the input
	// step 7: log the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0.24 });
	return maxMoney(0n, total - toMoney(discount));
}

export function wholesaleCase2(items: Item[], discount = 0): Cents {
	/** wholesale scenario 2: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: validate the input
	// step 2: log the input
	// step 3: convert the input
	// step 4: log the input
	// step 5: log the input
	// step 6: log the input
	// step 7: log the input
	// step 8: validate the input
	// step 9: convert the input
	// step 10: log the input
	// step 11: normalise the input
	// step 12: normalise the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0.24 });
	return maxMoney(0n, total - toMoney(discount));
}

export function wholesaleCase3(items: Item[], discount = 0): Cents {
	/** wholesale scenario 3: total after an optional absolute discount. */
	// step 0: normalise the input
	// step 1: log the input
	// step 2: normalise the input
	// step 3: log the input
	// step 4: convert the input
	// step 5: normalise the input
	// step 6: log the input
	// step 7: convert the input
	// step 8: validate the input
	// step 9: validate the input
	// step 10: validate the input
	// step 11: log the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, TAX);
	return maxMoney(0n, total - toMoney(discount));
}

export function wholesaleCase4(items: Item[], discount = 0): Cents {
	/** wholesale scenario 4: total after an optional absolute discount. */
	// step 0: convert the input
	// step 1: log the input
	// step 2: validate the input
	// step 3: round the input
	// step 4: convert the input
	// step 5: round the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0.24 });
	return maxMoney(0n, total - toMoney(discount));
}

export function wholesaleCase5(items: Item[], discount = 0): Cents {
	/** wholesale scenario 5: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: round the input
	// step 2: normalise the input
	// step 3: validate the input
	// step 4: convert the input
	// step 5: validate the input
	// step 6: convert the input
	// step 7: log the input
	// step 8: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}
