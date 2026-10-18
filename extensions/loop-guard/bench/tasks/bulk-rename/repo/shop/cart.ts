import { calcTotal, type Item } from "./money.ts";

export function cartTotal(cart: { items: Item[]; tax: number }): number {
	return calcTotal(cart.items, cart.tax);
}
