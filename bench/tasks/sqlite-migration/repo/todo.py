import sqlite3


def open_db(path):
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, "
                 "done INTEGER NOT NULL DEFAULT 0)")
    conn.commit()
    return conn


def add_task(conn, title):
    cur = conn.execute("INSERT INTO tasks (title) VALUES (?)", (title,))
    conn.commit()
    return cur.lastrowid


def complete(conn, task_id):
    conn.execute("UPDATE tasks SET done = 1 WHERE id = ?", (task_id,))
    conn.commit()


def list_tasks(conn):
    rows = conn.execute("SELECT id, title, done FROM tasks ORDER BY id").fetchall()
    return [{"id": r[0], "title": r[1], "done": bool(r[2])} for r in rows]
