import io, os, tempfile, unittest
from contextlib import redirect_stdout
import inventory

CSV = "name,qty,price\nwidget,5,2.50\nbolt,100,0.10\n"


class InventoryTest(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".csv")
        with os.fdopen(fd, "w") as f:
            f.write(CSV)

    def tearDown(self):
        os.unlink(self.path)

    def test_table(self):
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(inventory.main([self.path]), 0)
        self.assertIn("widget", out.getvalue())
        self.assertLess(out.getvalue().index("bolt"), out.getvalue().index("widget"))


if __name__ == "__main__":
    unittest.main()
