import { orderTotal, type Item } from "./money.ts";

export function cartTotal(cart: { items: Item[]; tax: number }): number {
	return orderTotal(cart.items, { taxRate: cart.tax });
}
