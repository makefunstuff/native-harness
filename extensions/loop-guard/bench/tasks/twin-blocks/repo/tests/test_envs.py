import unittest
from deploy.envs import ENVS


class EnvsTest(unittest.TestCase):
    def test_names(self):
        for name, fn in ENVS.items():
            self.assertEqual(fn()["name"], name)


if __name__ == "__main__":
    unittest.main()
