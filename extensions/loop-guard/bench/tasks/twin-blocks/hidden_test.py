import unittest
from deploy.envs import ENVS


class Hidden(unittest.TestCase):
    def test_production(self):
        self.assertEqual(ENVS["production"](), {"name": "production", "timeout": 120, "retries": 5, "canary": True, "region": "eu-north-1"})

    def test_others_unchanged(self):
        self.assertEqual(ENVS["staging"](), {"name": "staging", "timeout": 60, "retries": 3, "canary": True})
        self.assertEqual(ENVS["dev"](), {"name": "dev", "timeout": 30, "retries": 1})
