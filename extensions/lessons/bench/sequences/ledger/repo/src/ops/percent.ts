import { type Cents, LedgerError, assertCents, roundHalfEven } from "../money.ts";

// pct percent of an amount, in whole cents.
export function percentOf(amount: Cents, pct: number): Cents {
	assertCents(amount);
	if (!Number.isFinite(pct)) throw new LedgerError("INVALID_PERCENT", `percent must be a number, got ${pct}`);
	return roundHalfEven((amount * pct) / 100);
}
