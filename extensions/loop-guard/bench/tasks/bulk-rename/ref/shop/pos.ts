import { orderTotal, type Item } from "./money.ts";

// The register charges a flat 10 % (orderTotal handles the rounding).
export function register(items: Item[]): number {
	return orderTotal(items, { taxRate: 0.1 });
}
