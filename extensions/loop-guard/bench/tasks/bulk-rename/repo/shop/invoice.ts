import { calcTotal, type Item } from "./money.ts";

export function invoiceLines(orders: Array<{ id: string; items: Item[]; tax: number }>): string[] {
	return orders.map((o) => `${o.id}: ${calcTotal(o.items, o.tax).toFixed(2)}`);
}
