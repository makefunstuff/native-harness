import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import * as todo from "./src/todo.ts";

const fresh = () => join(mkdtempSync(join(tmpdir(), "todo-")), "n.db");
function v1Db(): string {
	const p = fresh();
	const db = new DatabaseSync(p);
	db.exec("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)");
	db.exec("INSERT INTO tasks (title, done) VALUES ('old a', 0), ('old b', 1)");
	db.close();
	return p;
}
const version = (db: DatabaseSync) => db.prepare("SELECT * FROM schema_version").all().map((r: any) => Object.values(r).map(Number));

test("a new database starts at version 2", () => {
	const db = todo.openDb(fresh());
	assert.deepEqual(version(db), [[2]]);
	(todo.addTask as any)(db, "x", "2026-10-20");
	assert.equal((todo.listTasks(db)[0] as any).dueDate, "2026-10-20");
});

test("a version-1 database is migrated with its rows; reopening changes nothing", () => {
	const p = v1Db();
	let db = todo.openDb(p);
	assert.deepEqual(version(db), [[2]]);
	assert.deepEqual(todo.listTasks(db).map((r: any) => [r.title, r.done, r.dueDate]), [["old a", false, null], ["old b", true, null]]);
	db.close();
	db = todo.openDb(p);
	assert.deepEqual(version(db), [[2]]);
	assert.equal(todo.listTasks(db).length, 2);
});

test("the old API keeps working", () => {
	const db = todo.openDb(fresh());
	const id = todo.addTask(db, "plain");
	todo.complete(db, id);
	assert.deepEqual(todo.listTasks(db), [{ id, title: "plain", done: true, dueDate: null }] as any);
});

test("bad due dates throw RangeError and store nothing", () => {
	const db = todo.openDb(fresh());
	for (const bad of ["2026-13-01", "tomorrow", "2026-2-3", "2026-02-30", 20261001]) assert.throws(() => (todo.addTask as any)(db, "x", bad), RangeError, String(bad));
	assert.deepEqual(todo.listTasks(db), []);
	(todo.addTask as any)(db, "null is fine", null);
	assert.equal(todo.listTasks(db).length, 1);
});

test("overdue", () => {
	const db = todo.openDb(fresh());
	const add = todo.addTask as any;
	add(db, "late2", "2026-10-05");
	add(db, "late1", "2026-10-01");
	add(db, "future", "2026-11-01");
	add(db, "nodate");
	todo.complete(db, add(db, "donelate", "2026-09-01"));
	add(db, "today", "2026-10-14");
	assert.deepEqual((todo as any).overdue(db, "2026-10-14"), ["late1", "late2"]);
});

test("an unrelated table does not change the version", () => {
	const p = v1Db();
	const raw = new DatabaseSync(p);
	raw.exec("CREATE TABLE notes (x)");
	raw.close();
	const db = todo.openDb(p);
	assert.deepEqual(version(db), [[2]]);
	assert.equal(todo.listTasks(db).length, 2);
});
