// Self-test of the benchmark tickets: each ticket's hidden test fails on the repo as given and
// passes once the reference solution (ref/) is laid over it.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gradeTicket, TASKS } from "./tickets.ts";

for (const name of readdirSync(TASKS)) {
	test(`ticket ${name}: hidden test fails as given, passes with the reference`, async () => {
		const dir = mkdtempSync(join(tmpdir(), `tg-ticket-${name}-`));
		try {
			cpSync(join(TASKS, name, "repo"), dir, { recursive: true });
			assert.equal((await gradeTicket(name, dir)).passed, false, "repo as given must fail");
			cpSync(join(TASKS, name, "ref"), dir, { recursive: true });
			const graded = await gradeTicket(name, dir);
			assert.equal(graded.passed, true, graded.output);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}
