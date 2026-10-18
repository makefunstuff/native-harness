import unittest
from textkit import slugify


class Hidden(unittest.TestCase):
    def test_examples(self):
        self.assertEqual(slugify("Crème Brûlée -- Recipe!"), "creme-brulee-recipe")
        self.assertEqual(slugify("  Hello,   World  "), "hello-world")
        self.assertEqual(slugify("Ünïcödé 2026"), "unicode-2026")
        self.assertEqual(slugify("a_b.c"), "a-b-c")

    def test_empty(self):
        for bad in ["", "   ", "!!!", "--"]:
            with self.assertRaises(ValueError, msg=bad):
                slugify(bad)
