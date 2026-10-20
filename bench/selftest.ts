#!/usr/bin/env node
// Ticket self-test (CI): for every ticket of a root, the broken repo must FAIL the hidden tests and
// repo + reference must PASS both the hidden and the visible tests. A ticket whose broken repo
// passes grades an unfixed tree, and a reference that fails the hidden tests means the ticket is
// unsolvable as written: both are errors.
//
//   node bench/selftest.ts [TICKET_ROOT …]      (default: bench/tickets)
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { selftestAll } from "./lib/tickets.ts";
import { useTmpDir } from "./lib/util.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
useTmpDir(join(process.env.HOME ?? "/tmp", ".cache", "pi-extras", "selftest"));

const roots = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const bad = [];
for (const root of roots.length ? roots : [join(HERE, "tickets")]) {
	console.log(`== ${root}`);
	bad.push(...selftestAll(root));
}
if (bad.length) {
	console.log(`BAD TICKETS: ${bad.map((b) => b.name).join(", ")}`);
	process.exit(1);
}
console.log("tickets ok");
