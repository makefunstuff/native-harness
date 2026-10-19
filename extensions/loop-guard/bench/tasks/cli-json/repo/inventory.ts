// Stock report from a CSV file with a name,qty,price header.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface IO {
	out(line: string): void;
	err(line: string): void;
}

const consoleIO: IO = { out: (l) => console.log(l), err: (l) => console.error(l) };

export function main(argv: string[], io: IO = consoleIO): number {
	let file: string | undefined;
	let minQty = 0;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--min-qty") minQty = Number(argv[++i]);
		else file = argv[i];
	}
	if (!file) {
		io.err("usage: inventory.ts FILE [--min-qty N]");
		return 2;
	}
	const rows = readFileSync(file, "utf8").trim().split("\n").slice(1);
	for (const row of rows) {
		const [name, qty, price] = row.split(",");
		if (Number(qty) < minQty) continue;
		io.out(`${name.padEnd(20)} ${qty.padStart(5)} ${Number(price).toFixed(2).padStart(8)}`);
	}
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
