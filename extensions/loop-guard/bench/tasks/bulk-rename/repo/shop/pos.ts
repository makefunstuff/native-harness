import { calcTotal, type Item } from "./money.ts";

// The register charges a flat 10 % (calcTotal handles the rounding).
export function register(items: Item[]): number {
	return calcTotal(items, 0.1);
}
