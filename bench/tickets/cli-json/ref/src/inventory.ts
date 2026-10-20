// Stock report: `node src/inventory.ts items.csv [--min-qty N] [--format table|json]`.
import { readFileSync } from "node:fs";

export interface Io {
	readFile(path: string): string;
	out(text: string): void;
	err(text: string): void;
}

const defaultIo: Io = {
	readFile: (p) => readFileSync(p, "utf8"),
	out: (t) => void process.stdout.write(t),
	err: (t) => void process.stderr.write(t),
};

export function load(text: string): Array<Record<string, string>> {
	const [header, ...lines] = text.trim().split("\n");
	const cols = header.split(",");
	return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v.trim()])));
}

// argv: the arguments after the script name.
export function main(argv: string[], io: Io = defaultIo): number {
	let file: string | undefined;
	let minQty = 0;
	let format = "table";
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--min-qty") minQty = Number(argv[++i]);
		else if (argv[i] === "--format") format = argv[++i];
		else file = argv[i];
	}
	if (format !== "table" && format !== "json") {
		io.err(`unknown format: ${format} (use table or json)\n`);
		return 2;
	}
	if (!file) {
		io.err("usage: inventory.ts FILE [--min-qty N] [--format table|json]\n");
		return 2;
	}
	const rows: Array<{ name: string; qty: number; price: number }> = [];
	load(io.readFile(file)).forEach((r, i) => {
		const line = i + 2;
		if (!/^-?\d+$/.test(r.qty ?? "")) return io.err(`skipping line ${line}: qty ${JSON.stringify(r.qty)} is not an integer\n`);
		const price = Number(r.price);
		if (r.price === undefined || r.price === "" || !Number.isFinite(price)) return io.err(`skipping line ${line}: price ${JSON.stringify(r.price)} is not a number\n`);
		rows.push({ name: r.name, qty: Number(r.qty), price });
	});
	const shown = rows.filter((r) => r.qty >= minQty).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	if (format === "json") io.out(JSON.stringify(shown) + "\n");
	else for (const r of shown) io.out(`${r.name.padEnd(20)} ${String(r.qty).padStart(6)} ${r.price.toFixed(2).padStart(10)}\n`);
	return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
