import unittest, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import vat

class T(unittest.TestCase):
    def test_gross(self):
        self.assertEqual(vat.gross(100, "AT"), 100 + vat.RATES["at"]["standard"])

if __name__ == "__main__":
    unittest.main()
