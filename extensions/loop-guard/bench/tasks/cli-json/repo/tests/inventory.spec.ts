import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../inventory.ts";

test("table output", () => {
	const f = join(mkdtempSync(join(tmpdir(), "inv-")), "s.csv");
	writeFileSync(f, "name,qty,price\nbolt,10,0.25\nnut,2,0.1\n");
	const out: string[] = [];
	assert.equal(main([f, "--min-qty", "5"], { out: (l) => out.push(l), err: () => {} }), 0);
	assert.equal(out.length, 1);
	assert.match(out[0], /^bolt\s+10\s+0\.25$/);
});
