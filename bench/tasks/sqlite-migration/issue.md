`todo.py` stores tasks in SQLite. We need a `due_date` column, and the app has to keep
working with databases users already have.

- Introduce versioned migrations: a `schema_version` table holding a single integer.
  Version 1 = the current schema (`tasks(id INTEGER PRIMARY KEY, title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0)`); version 2 adds `due_date TEXT` (ISO date, nullable).
- `open_db(path)` must bring any database to version 2: a new file is created at
  version 2; an existing database from the current release (it has a `tasks` table but
  no `schema_version` table) counts as version 1 and is migrated in place with all its rows kept;
  opening an already-migrated database changes nothing. Each migration runs in a
  transaction, so a failure leaves the database at the previous version.
- `add_task(conn, title, due_date=None)` stores the due date; `due_date` must be
  `None` or a valid `YYYY-MM-DD` string, otherwise raise `ValueError` and store nothing.
- `overdue(conn, today)` returns the titles of not-done tasks with `due_date < today`,
  ordered by due date then id.
- Existing functions (`add_task(conn, title)`, `complete(conn, id)`, `list_tasks(conn)`)
  keep working; `list_tasks` returns dicts and now includes `due_date`.
Run the tests with: python3 -m unittest discover -s tests
