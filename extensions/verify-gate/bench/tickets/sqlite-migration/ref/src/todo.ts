// Tasks in SQLite, with versioned migrations.
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS: Record<number, string> = {
	1: "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)",
	2: "ALTER TABLE tasks ADD COLUMN due_date TEXT",
};
const LATEST = 2;

function version(db: DatabaseSync): number {
	const has = (name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
	if (has("schema_version")) return Number((db.prepare("SELECT version FROM schema_version").get() as any).version);
	return has("tasks") ? 1 : 0;
}

export function openDb(path: string): DatabaseSync {
	const db = new DatabaseSync(path);
	for (let v = version(db); v < LATEST; v++) {
		db.exec("BEGIN");
		try {
			db.exec(MIGRATIONS[v + 1]);
			db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
			db.exec("DELETE FROM schema_version");
			db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(v + 1);
			db.exec("COMMIT");
		} catch (e) {
			db.exec("ROLLBACK");
			throw e;
		}
	}
	return db;
}

function validDate(d: unknown): boolean {
	if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
	const t = new Date(`${d}T00:00:00Z`);
	return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

export function addTask(db: DatabaseSync, title: string, dueDate: string | null = null): number {
	if (dueDate !== null && !validDate(dueDate)) throw new RangeError(`bad due date: ${JSON.stringify(dueDate)}`);
	return Number(db.prepare("INSERT INTO tasks (title, due_date) VALUES (?, ?)").run(title, dueDate).lastInsertRowid);
}

export function complete(db: DatabaseSync, id: number): void {
	db.prepare("UPDATE tasks SET done = 1 WHERE id = ?").run(id);
}

export function listTasks(db: DatabaseSync): Array<{ id: number; title: string; done: boolean; dueDate: string | null }> {
	return db
		.prepare("SELECT id, title, done, due_date FROM tasks ORDER BY id")
		.all()
		.map((r: any) => ({ id: Number(r.id), title: r.title, done: Boolean(r.done), dueDate: r.due_date ?? null }));
}

export function overdue(db: DatabaseSync, today: string): string[] {
	return db
		.prepare("SELECT title FROM tasks WHERE done = 0 AND due_date IS NOT NULL AND due_date < ? ORDER BY due_date, id")
		.all(today)
		.map((r: any) => r.title);
}
