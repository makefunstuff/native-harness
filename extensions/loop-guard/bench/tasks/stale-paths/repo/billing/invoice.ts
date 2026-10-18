// Invoice arithmetic. Amounts are integer cents.

export function lineTotal(qty: number, unitPrice: string): number {
	return Math.round(qty * parseFloat(unitPrice) * 100);
}

export function invoiceTotal(lines: Array<[number, string]>): number {
	return lines.reduce((sum, [qty, price]) => sum + lineTotal(qty, price), 0);
}
