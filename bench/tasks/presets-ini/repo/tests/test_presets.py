import os, unittest
import presets

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class PresetsTest(unittest.TestCase):
    def test_sample(self):
        p = presets.load_presets(os.path.join(HERE, "sample.ini"))
        self.assertEqual(list(p), ["qwen3.8-27b", "zeta-2.1-q4"])
        self.assertEqual(p["zeta-2.1-q4"]["temp"], "0.0")


if __name__ == "__main__":
    unittest.main()
