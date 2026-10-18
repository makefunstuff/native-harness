import assert from "node:assert/strict";
import { test } from "node:test";
import { Job, Scheduler } from "../src/jobs.ts";

test("tick", () => {
	const s = new Scheduler();
	s.add(new Job("a", 10, () => 1));
	assert.deepEqual(s.tick(0), { a: 1 });
	assert.deepEqual(s.tick(5), {});
});
