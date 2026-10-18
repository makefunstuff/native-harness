import { orderTotal, type Item } from "./money.ts";

export function audit(orders: Array<{ items: Item[]; tax: number }>): number {
	return orders.reduce((s, o) => s + orderTotal(o.items, { taxRate: o.tax }), 0);
}
