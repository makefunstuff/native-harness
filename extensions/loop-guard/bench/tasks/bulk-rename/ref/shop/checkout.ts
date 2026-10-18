import { orderTotal, type Item } from "./money.ts";

const RATES: Record<string, number> = { EU: 0.2, US: 0.07 };

export function checkout(items: Item[], region: string): number {
	return orderTotal(items, { taxRate: RATES[region] ?? 0 });
}
