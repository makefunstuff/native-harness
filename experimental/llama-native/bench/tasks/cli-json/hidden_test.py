import io, json, os, tempfile, unittest
from contextlib import redirect_stdout, redirect_stderr
import inventory

CSV = ("name,qty,price\nwidget,5,2.50\nbolt,100,0.10\nnut,abc,1.00\n"
       "gear,7,x\naxle,0,12\n")


def run(args):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        try:
            rc = inventory.main(args)
        except SystemExit as e:
            rc = e.code
    return rc, out.getvalue(), err.getvalue()


class Hidden(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".csv")
        with os.fdopen(fd, "w") as f:
            f.write(CSV)

    def tearDown(self):
        os.unlink(self.path)

    def test_json(self):
        rc, out, _ = run([self.path, "--format", "json"])
        self.assertEqual(rc, 0)
        data = json.loads(out)
        self.assertEqual(data, [{"name": "axle", "qty": 0, "price": 12.0},
                                {"name": "bolt", "qty": 100, "price": 0.1},
                                {"name": "widget", "qty": 5, "price": 2.5}])
        self.assertIsInstance(data[0]["qty"], int)
        self.assertIsInstance(data[0]["price"], float)

    def test_json_min_qty(self):
        rc, out, _ = run([self.path, "--format", "json", "--min-qty", "5"])
        self.assertEqual([d["name"] for d in json.loads(out)], ["bolt", "widget"])

    def test_table_default_and_filter(self):
        rc, out, _ = run([self.path, "--min-qty", "6"])
        self.assertEqual(rc, 0)
        self.assertIn("bolt", out)
        self.assertNotIn("widget", out)
        self.assertNotIn("[", out)

    def test_bad_rows_warned(self):
        for fmt in ("table", "json"):
            rc, out, err = run([self.path, "--format", fmt])
            self.assertEqual(rc, 0)
            lines = [l for l in err.splitlines() if l.startswith("skipping row")]
            self.assertEqual(len(lines), 2, err)
            self.assertTrue(any(l.startswith("skipping row 3") for l in lines), err)
            self.assertTrue(any(l.startswith("skipping row 4") for l in lines), err)
            self.assertNotIn("nut", out)
            self.assertNotIn("gear", out)

    def test_unknown_format(self):
        rc, _, _ = run([self.path, "--format", "xml"])
        self.assertEqual(rc, 2)

    def test_readme(self):
        readme = open(os.path.join(os.path.dirname(inventory.__file__), "README.md")).read()
        self.assertIn("--format", readme)


if __name__ == "__main__":
    unittest.main()
