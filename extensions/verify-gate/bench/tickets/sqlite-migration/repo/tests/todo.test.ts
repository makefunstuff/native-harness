import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addTask, complete, listTasks, openDb } from "../src/todo.ts";

test("round trip", () => {
	const db = openDb(join(mkdtempSync(join(tmpdir(), "todo-")), "t.db"));
	const id = addTask(db, "write tests");
	complete(db, id);
	assert.equal(listTasks(db)[0].done, true);
});
