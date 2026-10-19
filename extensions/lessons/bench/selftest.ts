#!/usr/bin/env node
// Self-test of the lessons benchmark's tickets, no model involved:
//   - every base repo passes its own tests and checker, and fails every ticket's hidden tests;
//   - every reference solution passes the repo's tests and the hidden tests;
//   - each trap, put into a reference solution on purpose, shows up in the visible test output
//     (so a session can hit it and fix it) and in the hidden results (so the grader sees it stay).
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SEQ_DIR, TRAPS, type Ticket, applyRef, checker, hidden, prepare, sequences, tickets, trapsHit, visible } from "./tickets.ts";

const root = mkdtempSync(join(tmpdir(), "lessons-selftest-"));
let failures = 0;
const check = (ok: boolean, what: string) => {
	if (!ok) failures++;
	console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

// Put one trap into a prepared reference solution, in the ticket's own new file. Returns false
// when the reference has nothing to break for that trap (it never touches Date methods itself).
function breakIt(t: Ticket, work: string, trap: string): boolean {
	prepare(t, work);
	if (["docs", "testfile", "codes", "changelog"].includes(trap)) {
		applyRef(t, work, [trap]);
		return true;
	}
	applyRef(t, work);
	const ref = join(SEQ_DIR, t.seq, "tickets", t.name, "ref");
	const p = join(work, (readdirSync(ref, { recursive: true }) as string[]).find((f) => f.endsWith(".ts"))!);
	const before = readFileSync(p, "utf8");
	let s = before;
	if (trap === "example") s = s.replace(/^\s*\* @example.*\n/gm, "");
	if (trap === "utc") s = s.replace(/getUTC(Day|Date|Month|FullYear)\(/g, "get$1(").replace(/setUTCDate\(/g, "setDate(");
	writeFileSync(p, s);
	return s !== before;
}

try {
	for (const seq of sequences()) {
		const all = tickets(seq);
		check(all.length >= 4, `${seq}: ${all.length} tickets`);
		const base = join(root, seq, "base");
		prepare(all[0], base);
		const v = visible(base);
		check(v.ok, `${seq}: base repo passes its own tests`);
		for (const t of all) {
			const work = join(root, seq, t.name);
			prepare(t, work);
			check(!hidden(t, work).ok, `${seq}/${t.name}: base fails the hidden tests`);
			applyRef(t, work);
			const vr = visible(work);
			const hr = hidden(t, work);
			check(vr.ok, `${seq}/${t.name}: reference passes the repo's tests${vr.ok ? "" : `\n${vr.output.slice(-1500)}`}`);
			check(hr.ok, `${seq}/${t.name}: reference passes the hidden tests${hr.ok ? "" : ` (failed: ${hr.failed.join("; ")})\n${hr.output.slice(-1500)}`}`);
			for (const trap of t.traps) {
				const w = join(root, seq, `${t.name}-${trap}`);
				if (!breakIt(t, w, trap)) {
					console.log(`skip ${seq}/${t.name} +${trap}: the reference has nothing to break`);
					continue;
				}
				const vb = visible(w);
				const hb = hidden(t, w);
				const hit = trapsHit(t, [vb.output], hb);
				check(hit.visible.includes(trap), `${seq}/${t.name} +${trap}: the repo's tests report it`);
				check(hit.hidden.includes(trap), `${seq}/${t.name} +${trap}: the hidden tests catch it (failed: ${hb.failed.join("; ")})`);
				const others = hit.visible.filter((x) => x !== trap);
				check(others.length === 0, `${seq}/${t.name} +${trap}: no other trap reported${others.length ? ` (${others})` : ""}`);
			}
		}
		// reading the checker must not count as hitting a trap
		const src = readFileSync(checker(seq), "utf8");
		check(TRAPS[seq].every((tr) => !tr.signature.test(src)), `${seq}: the checker's own text matches no trap signature`);
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}
console.log(failures ? `${failures} FAILED` : "selftest OK");
process.exit(failures ? 1 : 0);
