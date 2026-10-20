// Tasks in SQLite.
import { DatabaseSync } from "node:sqlite";

export function openDb(path: string): DatabaseSync {
	const db = new DatabaseSync(path);
	db.exec("CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)");
	return db;
}

export function addTask(db: DatabaseSync, title: string): number {
	return Number(db.prepare("INSERT INTO tasks (title) VALUES (?)").run(title).lastInsertRowid);
}

export function complete(db: DatabaseSync, id: number): void {
	db.prepare("UPDATE tasks SET done = 1 WHERE id = ?").run(id);
}

export function listTasks(db: DatabaseSync): Array<{ id: number; title: string; done: boolean }> {
	return db.prepare("SELECT id, title, done FROM tasks ORDER BY id").all().map((r: any) => ({ id: Number(r.id), title: r.title, done: Boolean(r.done) }));
}
