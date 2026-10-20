// Stock report: `node src/inventory.ts items.csv [--min-qty N]`.
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
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--min-qty") minQty = Number(argv[++i]);
		else file = argv[i];
	}
	if (!file) {
		io.err("usage: inventory.ts FILE [--min-qty N]\n");
		return 2;
	}
	const rows = load(io.readFile(file)).filter((r) => Number(r.qty) >= minQty);
	rows.sort((a, b) => a.name.localeCompare(b.name));
	for (const r of rows) io.out(`${r.name.padEnd(20)} ${String(Number(r.qty)).padStart(6)} ${Number(r.price).toFixed(2).padStart(10)}\n`);
	return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
