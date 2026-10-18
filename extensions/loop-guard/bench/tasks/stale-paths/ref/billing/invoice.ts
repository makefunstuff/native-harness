// Invoice arithmetic. Amounts are integer cents.

export function lineTotal(qty: number, unitPrice: string): number {
	if (!Number.isInteger(qty) || qty < 0) throw new RangeError(`bad quantity: ${qty}`);
	const m = /^(\d+)(?:\.(\d+))?$/.exec(unitPrice);
	if (!m) throw new RangeError(`bad price: ${unitPrice}`);
	const frac = m[2] ?? "";
	const scaled = BigInt(m[1] + frac) * BigInt(qty); // price * 10^frac.length
	const digits = frac.length;
	if (digits <= 2) return Number(scaled * 10n ** BigInt(2 - digits));
	const div = 10n ** BigInt(digits - 2);
	return Number((scaled * 2n + div) / (2n * div));
}

export function invoiceTotal(lines: Array<[number, string]>): number {
	return lines.reduce((sum, [qty, price]) => sum + lineTotal(qty, price), 0);
}
