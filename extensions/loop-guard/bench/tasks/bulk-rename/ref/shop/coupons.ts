import * as money from "./money.ts";

export function applyCoupon(items: money.Item[], tax: number, pct: number): number {
	const discounted = items.map(([p, q]) => [p * (1 - pct), q] as money.Item);
	return money.orderTotal(discounted, { taxRate: tax });
}
