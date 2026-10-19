// Money helpers. Amounts are integer cents.

export type Cents = number;

// Errors raised by operations; `code` is what the billing service matches on.
export class LedgerError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "LedgerError";
		this.code = code;
	}
}

// Round to whole cents, halves to the even neighbour (banker's rounding), as the accounting
// department requires: 2.5 → 2, 3.5 → 4, -2.5 → -2.
export function roundHalfEven(x: number): Cents {
	const f = Math.floor(x);
	const d = x - f;
	if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
	return d < 0.5 ? f : f + 1;
}

export function assertCents(x: unknown, name = "amount"): asserts x is Cents {
	if (typeof x !== "number" || !Number.isInteger(x)) throw new LedgerError("INVALID_AMOUNT", `${name} must be integer cents, got ${String(x)}`);
}
