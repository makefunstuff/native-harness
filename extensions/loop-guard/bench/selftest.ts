#!/usr/bin/env node
// Check every ticket: the starting tree fails its hidden tests, the reference fix passes them and
// the tree's own tests. No model involved.  node extensions/loop-guard/bench/selftest.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grade, ownTests, seed, tickets } from "./lib.ts";

let bad = 0;
const tmp = mkdtempSync(join(tmpdir(), "loop-guard-selftest-"));
for (const t of tickets()) {
	const work = join(tmp, t.name);
	seed(t, work);
	const broken = grade(t, work);
	seed(t, work, true);
	const fixed = grade(t, work);
	const own = ownTests(work);
	const ok = !broken.passed && fixed.passed && own;
	if (!ok) bad++;
	console.log(`${ok ? "ok  " : "FAIL"} ${t.name}: start ${broken.passed ? "passes (wrong)" : "fails"}, reference ${fixed.passed ? "passes" : "fails (wrong)"}, own tests on reference ${own ? "pass" : "fail (wrong)"}`);
	if (!fixed.passed) console.log(fixed.tail);
}
rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
