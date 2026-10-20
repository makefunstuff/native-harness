`src/todo.ts` stores tasks in SQLite (`node:sqlite`). We need a `due_date` column, and the app has
to keep working with databases users already have.

- Introduce versioned migrations: a `schema_version` table holding a single integer. Version 1 =
  the current schema (`tasks(id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL
  DEFAULT 0)`); version 2 adds `due_date TEXT` (ISO date, nullable).
- `openDb(path)` must bring any database to version 2: a new file is created at version 2; an
  existing database from the current release (it has a `tasks` table but no `schema_version`
  table) counts as version 1 and is migrated in place with all its rows kept; opening an
  already-migrated database changes nothing. Each migration runs in a transaction, so a failure
  leaves the database at the previous version.
- `addTask(db, title, dueDate?)` stores the due date; `dueDate` must be omitted, `null`, or a
  valid `YYYY-MM-DD` date string, otherwise throw a `RangeError` and store nothing.
- `overdue(db, today)` returns the titles of not-done tasks with `due_date < today`, ordered by
  due date then id.
- The existing functions (`addTask(db, title)`, `complete(db, id)`, `listTasks(db)`) keep
  working; `listTasks` returns objects and now includes `dueDate` (`null` when unset).
