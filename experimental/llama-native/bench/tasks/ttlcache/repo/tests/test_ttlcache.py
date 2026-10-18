import unittest
from ttlcache import TTLCache


class CacheTest(unittest.TestCase):
    def test_hit(self):
        calls = []
        c = TTLCache(60)
        self.assertEqual(c.get_or_compute("a", lambda: calls.append(1) or 5), 5)
        self.assertEqual(c.get_or_compute("a", lambda: calls.append(1) or 6), 5)
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
