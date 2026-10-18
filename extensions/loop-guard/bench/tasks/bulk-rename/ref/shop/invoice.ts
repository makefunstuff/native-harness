import { orderTotal, type Item } from "./money.ts";

export function invoiceLines(orders: Array<{ id: string; items: Item[]; tax: number }>): string[] {
	return orders.map((o) => `${o.id}: ${orderTotal(o.items, { taxRate: o.tax }).toFixed(2)}`);
}
