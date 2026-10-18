import datetime, re, sqlite3

V1 = "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)"


def _version(conn):
    has = lambda t: conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone()
    if has("schema_version"):
        return conn.execute("SELECT v FROM schema_version").fetchone()[0]
    return 1 if has("tasks") else 0


def open_db(path):
    conn = sqlite3.connect(path, isolation_level=None)
    v = _version(conn)
    steps = {0: [V1], 1: ["ALTER TABLE tasks ADD COLUMN due_date TEXT"]}
    while v < 2:
        conn.execute("BEGIN")
        try:
            for s in steps[v]:
                conn.execute(s)
            conn.execute("CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)")
            conn.execute("DELETE FROM schema_version")
            conn.execute("INSERT INTO schema_version VALUES (?)", (v + 1,))
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        v += 1
    return conn


def _check(d):
    if d is None:
        return
    if not isinstance(d, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        raise ValueError(f"bad due_date {d!r}")
    datetime.date.fromisoformat(d)


def add_task(conn, title, due_date=None):
    _check(due_date)
    return conn.execute("INSERT INTO tasks (title, due_date) VALUES (?, ?)", (title, due_date)).lastrowid


def complete(conn, task_id):
    conn.execute("UPDATE tasks SET done = 1 WHERE id = ?", (task_id,))


def list_tasks(conn):
    return [{"id": r[0], "title": r[1], "done": bool(r[2]), "due_date": r[3]}
            for r in conn.execute("SELECT id, title, done, due_date FROM tasks ORDER BY id")]


def overdue(conn, today):
    return [r[0] for r in conn.execute(
        "SELECT title FROM tasks WHERE done = 0 AND due_date IS NOT NULL AND due_date < ? "
        "ORDER BY due_date, id", (today,))]
