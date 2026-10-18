import unittest
from decimal import Decimal
from billing.invoice import invoice_total, line_total


class Hidden(unittest.TestCase):
    def test_half_up(self):
        self.assertEqual(line_total(2, Decimal("1.005")), Decimal("2.01"))
        self.assertEqual(line_total(1, Decimal("0.125")), Decimal("0.13"))
        self.assertEqual(line_total(1, 0.125), Decimal("0.13"))

    def test_returns_decimal(self):
        self.assertIsInstance(line_total(3, 2.5), Decimal)
        self.assertIsInstance(invoice_total([(1, 1)]), Decimal)

    def test_total_sums_rounded_lines(self):
        self.assertEqual(invoice_total([(1, Decimal("0.005")), (1, Decimal("0.005"))]), Decimal("0.02"))
        self.assertEqual(invoice_total([]), Decimal("0"))

    def test_negative(self):
        with self.assertRaises(ValueError):
            line_total(-1, 2)
        with self.assertRaises(ValueError):
            invoice_total([(1, 1), (-2, 1)])

    def test_layout_kept(self):
        import os
        self.assertTrue(os.path.exists("billing/invoice.py"))
        self.assertFalse(os.path.exists("src/billing/invoice.py"))
