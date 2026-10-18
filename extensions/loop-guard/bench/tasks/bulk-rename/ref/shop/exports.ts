import { orderTotal, type Item } from "./money.ts";

export function toCsv(orders: Array<{ id: string; items: Item[]; tax: number }>): string {
	const rows = orders.map((o) => [o.id, o.items.length, orderTotal(o.items, { taxRate: o.tax })].join(","));
	return ["id,lines,total", ...rows].join("\n");
}
