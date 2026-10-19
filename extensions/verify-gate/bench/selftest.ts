#!/usr/bin/env node
// Self-test of the bench tickets (no model): the broken repo fails its hidden tests, the reference
// solution passes the hidden and the visible tests. Run by scripts/check.sh.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hidden, prepare, ticketNames, visible } from "./tickets.ts";

const root = mkdtempSync(join(process.env.PI_EXTRAS_TMP ?? tmpdir(), "verify-gate-selftest-"));
let bad = 0;
try {
	for (const name of ticketNames()) {
		const work = join(root, name);
		prepare(name, work);
		const broken = hidden(name, work);
		prepare(name, work, { withRef: true });
		const ref = hidden(name, work);
		const vis = visible(work);
		const ok = !broken.ok && ref.ok && vis.ok;
		if (!ok) bad++;
		console.log(`${ok ? "ok  " : "FAIL"} ${name} broken-hidden=${broken.ok ? "PASS(!)" : "fail"} ref-hidden=${ref.ok ? "PASS" : "fail"} ref-visible=${vis.ok ? "PASS" : "fail"}`);
		if (!ref.ok) console.log(ref.tail.replace(/^/gm, "      "));
		if (!vis.ok) console.log(vis.tail.replace(/^/gm, "      "));
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}
if (bad) {
	console.log(`TICKET SELF-TEST FAILED (${bad})`);
	process.exit(1);
}
console.log("TICKET SELF-TEST OK");
