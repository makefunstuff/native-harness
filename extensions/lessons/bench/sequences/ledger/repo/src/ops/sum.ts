import { type Cents, assertCents } from "../money.ts";

export function sumCents(amounts: Cents[]): Cents {
	let total = 0;
	for (const a of amounts) {
		assertCents(a);
		total += a;
	}
	return total;
}
