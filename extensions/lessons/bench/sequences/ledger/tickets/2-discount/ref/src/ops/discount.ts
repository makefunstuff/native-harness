import { type Cents, LedgerError, assertCents, roundHalfEven } from "../money.ts";

export function applyDiscount(price: Cents, pct: number): Cents {
	assertCents(price, "price");
	if (price < 0) throw new LedgerError("NEGATIVE_AMOUNT", `price must not be negative, got ${price}`);
	if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new LedgerError("INVALID_PERCENT", `percent must be 0..100, got ${pct}`);
	return price - roundHalfEven((price * pct) / 100);
}
