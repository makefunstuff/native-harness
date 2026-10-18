import os, tempfile, unittest
import todo


class TodoTest(unittest.TestCase):
    def test_roundtrip(self):
        d = tempfile.mkdtemp()
        conn = todo.open_db(os.path.join(d, "t.db"))
        i = todo.add_task(conn, "write tests")
        todo.complete(conn, i)
        self.assertTrue(todo.list_tasks(conn)[0]["done"])


if __name__ == "__main__":
    unittest.main()
