import unittest
from billing.invoice import invoice_total, line_total


class InvoiceTest(unittest.TestCase):
    def test_simple(self):
        self.assertEqual(float(line_total(3, 2.5)), 7.5)

    def test_total(self):
        self.assertEqual(float(invoice_total([(1, 1.25), (2, 2.0)])), 5.25)


if __name__ == "__main__":
    unittest.main()
