import unittest
from textkit import slugify


class SlugifyTest(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(slugify("hello world"), "hello-world")


if __name__ == "__main__":
    unittest.main()
