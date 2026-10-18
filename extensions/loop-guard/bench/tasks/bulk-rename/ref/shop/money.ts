// Money helpers shared by every shop module. Items are [price, qty] pairs.
export type Item = [number, number];

const round2 = (x: number) => Math.round(x * 100) / 100;

export function orderTotal(items: Item[], opts: { taxRate: number }): number {
	if (typeof opts !== "object" || opts === null || typeof opts.taxRate !== "number") throw new TypeError("orderTotal(items, { taxRate })");
	return round2(items.reduce((s, [p, q]) => s + p * q, 0) * (1 + opts.taxRate));
}

/** @deprecated use orderTotal(items, { taxRate }) */
export function calcTotal(items: Item[], tax: number): number {
	process.emitWarning("calcTotal is deprecated, use orderTotal", "DeprecationWarning");
	return orderTotal(items, { taxRate: tax });
}
