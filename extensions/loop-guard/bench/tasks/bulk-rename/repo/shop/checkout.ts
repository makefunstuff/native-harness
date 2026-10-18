import { calcTotal, type Item } from "./money.ts";

const RATES: Record<string, number> = { EU: 0.2, US: 0.07 };

export function checkout(items: Item[], region: string): number {
	return calcTotal(items, RATES[region] ?? 0);
}
