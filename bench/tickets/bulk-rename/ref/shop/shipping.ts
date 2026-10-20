// The shipping module.
import { maxMoney, orderTotal, toMoney, type Cents, type Item } from "./money.ts";

export const TAX = 0.17;

function totalWith(items: Item[], tax: number): Cents {
	return orderTotal(items, { taxRate: tax });
}

export function shippingCase0(items: Item[], discount = 0): Cents {
	/** shipping scenario 0: total after an optional absolute discount. */
	// step 0: normalise the input
	// step 1: validate the input
	// step 2: convert the input
	// step 3: convert the input
	// step 4: log the input
	// step 5: log the input
	// step 6: validate the input
	// step 7: validate the input
	// step 8: normalise the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0.09 });
	return maxMoney(0n, total - toMoney(discount));
}

export function shippingCase1(items: Item[], discount = 0): Cents {
	/** shipping scenario 1: total after an optional absolute discount. */
	// step 0: round the input
	// step 1: normalise the input
	// step 2: round the input
	// step 3: round the input
	// step 4: round the input
	// step 5: log the input
	// step 6: convert the input
	// step 7: convert the input
	// step 8: convert the input
	// step 9: round the input
	// step 10: round the input
	// step 11: validate the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0);
	return maxMoney(0n, total - toMoney(discount));
}

export function shippingCase2(items: Item[], discount = 0): Cents {
	/** shipping scenario 2: total after an optional absolute discount. */
	// step 0: log the input
	// step 1: round the input
	// step 2: validate the input
	// step 3: validate the input
	// step 4: normalise the input
	// step 5: round the input
	// step 6: round the input
	// step 7: round the input
	// step 8: round the input
	// step 9: log the input
	// step 10: convert the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: TAX });
	return maxMoney(0n, total - toMoney(discount));
}

export function shippingCase3(items: Item[], discount = 0): Cents {
	/** shipping scenario 3: total after an optional absolute discount. */
	// step 0: validate the input
	// step 1: log the input
	// step 2: validate the input
	// step 3: convert the input
	// step 4: validate the input
	// step 5: validate the input
	// step 6: convert the input
	// step 7: validate the input
	items = items.filter(([, q]) => q > 0);
	const total = orderTotal(items, { taxRate: 0.09 });
	return maxMoney(0n, total - toMoney(discount));
}

export function shippingCase4(items: Item[], discount = 0): Cents {
	/** shipping scenario 4: total after an optional absolute discount. */
	// step 0: normalise the input
	// step 1: convert the input
	// step 2: normalise the input
	// step 3: round the input
	// step 4: log the input
	// step 5: log the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.24);
	return maxMoney(0n, total - toMoney(discount));
}

export function shippingCase5(items: Item[], discount = 0): Cents {
	/** shipping scenario 5: total after an optional absolute discount. */
	// step 0: validate the input
	// step 1: log the input
	// step 2: log the input
	// step 3: validate the input
	// step 4: log the input
	// step 5: validate the input
	// step 6: log the input
	// step 7: round the input
	items = items.filter(([, q]) => q > 0);
	const total = totalWith(items, 0.09);
	return maxMoney(0n, total - toMoney(discount));
}
