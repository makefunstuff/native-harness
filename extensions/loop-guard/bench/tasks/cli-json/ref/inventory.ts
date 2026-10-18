// Stock report from a CSV file with a name,qty,price header.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface IO {
	out(line: string): void;
	err(line: string): void;
}

const consoleIO: IO = { out: (l) => console.log(l), err: (l) => console.error(l) };
const USAGE = "usage: inventory.ts FILE [--min-qty N] [--format table|json]";

export function main(argv: string[], io: IO = consoleIO): number {
	let file: string | undefined;
	let minQty = 0;
	let format = "table";
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--min-qty") minQty = Number(argv[++i]);
		else if (argv[i] === "--format") format = argv[++i];
		else file = argv[i];
	}
	if (!file || !["table", "json"].includes(format)) {
		io.err(USAGE);
		return 2;
	}
	const items: Array<{ name: string; qty: number; price: number }> = [];
	readFileSync(file, "utf8").trim().split("\n").slice(1).forEach((row, i) => {
		const [name, qty, price] = row.split(",");
		const q = Number(qty), p = Number(price);
		if (!/^-?\d+$/.test(qty?.trim() ?? "") || price === undefined || price.trim() === "" || !Number.isFinite(p)) {
			io.err(`skipping row ${i + 1}: ${row}`);
			return;
		}
		if (q >= minQty) items.push({ name, qty: q, price: p });
	});
	if (format === "json") {
		io.out(JSON.stringify(items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))));
		return 0;
	}
	for (const it of items) io.out(`${it.name.padEnd(20)} ${String(it.qty).padStart(5)} ${it.price.toFixed(2).padStart(8)}`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
