import { type Cents, LedgerError, assertCents } from "../money.ts";

export function splitEvenly(total: Cents, parts: number): Cents[] {
	assertCents(total, "total");
	if (total < 0) throw new LedgerError("NEGATIVE_AMOUNT", `total must not be negative, got ${total}`);
	if (!Number.isInteger(parts) || parts < 1) throw new LedgerError("INVALID_PARTS", `parts must be a positive integer, got ${parts}`);
	const base = Math.floor(total / parts);
	const extra = total - base * parts;
	return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}
