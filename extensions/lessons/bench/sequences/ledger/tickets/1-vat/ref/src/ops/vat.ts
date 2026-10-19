import { type Cents, LedgerError, assertCents, roundHalfEven } from "../money.ts";

export function vatFor(net: Cents, ratePct: number): Cents {
	assertCents(net, "net");
	if (net < 0) throw new LedgerError("NEGATIVE_AMOUNT", `net must not be negative, got ${net}`);
	if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) throw new LedgerError("INVALID_RATE", `rate must be 0..100, got ${ratePct}`);
	return roundHalfEven((net * ratePct) / 100);
}
