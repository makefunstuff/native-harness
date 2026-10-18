import os, sqlite3, tempfile, unittest
import todo


def v1_db():
    p = os.path.join(tempfile.mkdtemp(), "old.db")
    c = sqlite3.connect(p)
    c.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)")
    c.executemany("INSERT INTO tasks (title, done) VALUES (?, ?)", [("old a", 0), ("old b", 1)])
    c.commit(); c.close()
    return p


def version(conn):
    return conn.execute("SELECT * FROM schema_version").fetchall()


class Hidden(unittest.TestCase):
    def test_fresh(self):
        conn = todo.open_db(os.path.join(tempfile.mkdtemp(), "n.db"))
        self.assertEqual(version(conn), [(2,)])
        todo.add_task(conn, "x", due_date="2026-10-20")
        self.assertEqual(todo.list_tasks(conn)[0]["due_date"], "2026-10-20")

    def test_migrate_v1_keeps_rows(self):
        p = v1_db()
        conn = todo.open_db(p)
        self.assertEqual(version(conn), [(2,)])
        rows = todo.list_tasks(conn)
        self.assertEqual([(r["title"], r["done"], r["due_date"]) for r in rows],
                         [("old a", False, None), ("old b", True, None)])
        conn.close()
        conn = todo.open_db(p)
        self.assertEqual(version(conn), [(2,)])
        self.assertEqual(len(todo.list_tasks(conn)), 2)

    def test_old_api(self):
        conn = todo.open_db(os.path.join(tempfile.mkdtemp(), "n.db"))
        i = todo.add_task(conn, "plain")
        todo.complete(conn, i)
        self.assertEqual(todo.list_tasks(conn), [{"id": i, "title": "plain", "done": True, "due_date": None}])

    def test_bad_due_date(self):
        conn = todo.open_db(os.path.join(tempfile.mkdtemp(), "n.db"))
        for bad in ("2026-13-01", "tomorrow", "2026-2-3", "2026-02-30", 20261001):
            with self.assertRaises(ValueError, msg=repr(bad)):
                todo.add_task(conn, "x", due_date=bad)
        self.assertEqual(todo.list_tasks(conn), [])

    def test_overdue(self):
        conn = todo.open_db(os.path.join(tempfile.mkdtemp(), "n.db"))
        todo.add_task(conn, "late2", due_date="2026-10-05")
        todo.add_task(conn, "late1", due_date="2026-10-01")
        todo.add_task(conn, "future", due_date="2026-11-01")
        todo.add_task(conn, "nodate")
        d = todo.add_task(conn, "donelate", due_date="2026-09-01")
        todo.complete(conn, d)
        todo.add_task(conn, "today", due_date="2026-10-14")
        self.assertEqual(todo.overdue(conn, "2026-10-14"), ["late1", "late2"])

    def test_unrelated_table_still_v1(self):
        p = v1_db()
        c = sqlite3.connect(p)
        c.execute("CREATE TABLE notes (x)")  # an extra table does not change the version
        c.commit(); c.close()
        conn = todo.open_db(p)
        self.assertEqual(version(conn), [(2,)])
        self.assertEqual(len(todo.list_tasks(conn)), 2)


if __name__ == "__main__":
    unittest.main()
