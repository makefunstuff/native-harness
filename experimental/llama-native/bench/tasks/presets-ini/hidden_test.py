import io, os, tempfile, unittest
from contextlib import redirect_stdout
import presets


def write(text):
    fd, p = tempfile.mkstemp(suffix=".ini")
    with os.fdopen(fd, "w") as f:
        f.write(text)
    return p


class Hidden(unittest.TestCase):
    def test_inherit_and_override(self):
        p = presets.load_presets(write("a = 1\nb = 2\n[x]\nb = 3\n[y]\n"))
        self.assertEqual(p, {"x": {"a": "1", "b": "3"}, "y": {"a": "1", "b": "2"}})

    def test_value_with_equals_and_spaces(self):
        p = presets.load_presets(write("[x]\n  args   =  --foo=bar baz=1  \n"))
        self.assertEqual(p["x"]["args"], "--foo=bar baz=1")

    def test_comments(self):
        p = presets.load_presets(write("# c\n; c\n   # indented\n\n[x]\nk = v # not a comment\n"))
        self.assertEqual(p["x"]["k"], "v # not a comment")

    def test_duplicate_section(self):
        with self.assertRaises(ValueError) as cm:
            presets.load_presets(write("[x]\nk=1\n\n[x]\n"))
        self.assertIn("4", str(cm.exception))

    def test_bad_line(self):
        with self.assertRaises(ValueError) as cm:
            presets.load_presets(write("[x]\nk=1\njunk line\n"))
        self.assertIn("3", str(cm.exception))

    def test_order(self):
        p = presets.load_presets(write("[b]\n[a]\n[c]\n"))
        self.assertEqual(list(p), ["b", "a", "c"])

    def test_report(self):
        path = write("[q]\nctx-size = 4096\ndevice = CUDA1\nspec-draft-model = /d.gguf\n[z]\nsplit-mode = tensor\n")
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(presets.main([path]), 0)
        self.assertEqual(out.getvalue().splitlines(), [
            "q ctx=4096 devices=CUDA1 split=layer draft=yes",
            "z ctx=- devices=- split=tensor draft=no"])


if __name__ == "__main__":
    unittest.main()
