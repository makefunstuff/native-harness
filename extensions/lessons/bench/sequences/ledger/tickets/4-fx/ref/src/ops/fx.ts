import { type Cents, LedgerError, assertCents, roundHalfEven } from "../money.ts";

export function convertCents(amount: Cents, rate: number): Cents {
	assertCents(amount);
	if (!Number.isFinite(rate) || rate <= 0) throw new LedgerError("INVALID_RATE", `rate must be above 0, got ${rate}`);
	return roundHalfEven(amount * rate);
}
