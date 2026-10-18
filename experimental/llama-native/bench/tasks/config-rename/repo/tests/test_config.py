import unittest
from svc.config import load_config


class ConfigTest(unittest.TestCase):
    def test_defaults(self):
        c = load_config({})
        self.assertEqual(c.port, 8080)


if __name__ == "__main__":
    unittest.main()
