// Money helpers shared by every shop module. Items are [price, qty] pairs.
export type Item = [number, number];

const round2 = (x: number) => Math.round(x * 100) / 100;

export function calcTotal(items: Item[], tax: number): number {
	return round2(items.reduce((s, [p, q]) => s + p * q, 0) * (1 + tax));
}
