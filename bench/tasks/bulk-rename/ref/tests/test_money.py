import unittest
from shop.money import order_total


class T(unittest.TestCase):
    def test_total(self):
        self.assertEqual(str(order_total([(10, 2), (1.5, 1)], tax_rate=0.2)), "25.80")


if __name__ == "__main__":
    unittest.main()
