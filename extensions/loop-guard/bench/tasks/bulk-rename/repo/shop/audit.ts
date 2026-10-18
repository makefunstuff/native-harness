import { calcTotal as total, type Item } from "./money.ts";

export function audit(orders: Array<{ items: Item[]; tax: number }>): number {
	return orders.reduce((s, o) => s + total(o.items, o.tax), 0);
}
