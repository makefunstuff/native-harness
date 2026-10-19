import { type Cents, LedgerError, assertCents, roundHalfEven } from "../money.ts";

export function simpleInterest(principal: Cents, annualPct: number, days: number): Cents {
	assertCents(principal, "principal");
	if (principal < 0) throw new LedgerError("NEGATIVE_AMOUNT", `principal must not be negative, got ${principal}`);
	if (!Number.isInteger(days) || days < 0) throw new LedgerError("INVALID_DAYS", `days must be an integer >= 0, got ${days}`);
	if (!Number.isFinite(annualPct) || annualPct < 0) throw new LedgerError("INVALID_RATE", `rate must be >= 0, got ${annualPct}`);
	return roundHalfEven((((principal * annualPct) / 100) * days) / 365);
}
