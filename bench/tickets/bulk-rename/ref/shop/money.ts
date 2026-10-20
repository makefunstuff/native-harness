// Money helpers shared by every shop module. Items are [price, qty] pairs.
// Money is cents (bigint): exact decimals, never binary floating point.
export type Item = [number, number];
export type Cents = bigint;

const DIGITS = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Parse a price (number, string) into cents, rounding half-up. */
export function toMoney(x: number | string): Cents {
	const s = String(x).trim();
	const m = DIGITS.exec(s);
	if (!m) throw new Error(`not an amount: ${s}`);
	const neg = m[1] === "-";
	const frac = (m[3] ?? "").padEnd(3, "0");
	let cents = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
	if (frac[2] >= "5") cents += 1n;
	return neg ? -cents : cents;
}

export function money(x: Cents): string {
	const s = (x < 0n ? -x : x).toString().padStart(3, "0");
	return `${x < 0n ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
}

function mulRate(cents: Cents, rate: number): Cents {
	const r = toMoney(rate); // the rate in cents: 0.2 -> 20
	const n = cents * (100n + r);
	const neg = n < 0n;
	const a = neg ? -n : n;
	const q = (a + 50n) / 100n; // half-up
	return neg ? -q : q;
}

export function maxMoney(a: Cents, b: Cents): Cents {
	return a > b ? a : b;
}

export function orderTotal(items: Item[], opts: { taxRate: number }): Cents {
	/** Total of [price, qty] pairs plus tax; opts.taxRate is a fraction (0.2 = 20%). */
	if (typeof opts !== "object" || opts === null || typeof (opts as any).taxRate !== "number")
		throw new TypeError("orderTotal(items, { taxRate }): the tax rate is an option, not a positional argument");
	const sub = items.reduce((s, [p, q]) => s + toMoney(p) * BigInt(q), 0n);
	return mulRate(sub, (opts as any).taxRate);
}

/** Deprecated: use orderTotal(items, { taxRate }). */
export function calcTotal(items: Item[], tax: number): Cents {
	process.emitWarning("calcTotal is deprecated, use orderTotal(items, { taxRate })", "DeprecationWarning");
	return orderTotal(items, { taxRate: tax });
}
