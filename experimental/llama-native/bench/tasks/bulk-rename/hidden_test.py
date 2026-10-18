import importlib, os, re, unittest, warnings

EXPECTED = {'cart.cart_case_0': ['60.42', '100.00'], 'cart.cart_case_1': ['75.40', '124.00'], 'cart.cart_case_2': ['66.66', '110.00'], 'cart.cart_case_3': ['66.04', '109.00'], 'cart.cart_case_4': ['66.66', '110.00'], 'cart.cart_case_5': ['66.04', '109.00'], 'checkout.checkout_case_0': ['72.90', '120.00'], 'checkout.checkout_case_1': ['75.40', '124.00'], 'checkout.checkout_case_2': ['75.40', '124.00'], 'checkout.checkout_case_3': ['66.04', '109.00'], 'checkout.checkout_case_4': ['60.42', '100.00'], 'checkout.checkout_case_5': ['66.04', '109.00'], 'invoice.invoice_case_0': ['67.91', '112.00'], 'invoice.invoice_case_1': ['66.04', '109.00'], 'invoice.invoice_case_2': ['72.90', '120.00'], 'invoice.invoice_case_3': ['60.42', '100.00'], 'invoice.invoice_case_4': ['67.91', '112.00'], 'invoice.invoice_case_5': ['66.04', '109.00'], 'refunds.refunds_case_0': ['66.04', '109.00'], 'refunds.refunds_case_1': ['66.04', '109.00'], 'refunds.refunds_case_2': ['60.42', '100.00'], 'refunds.refunds_case_3': ['75.40', '124.00'], 'refunds.refunds_case_4': ['60.42', '100.00'], 'refunds.refunds_case_5': ['68.53', '113.00'], 'reports.reports_case_0': ['66.04', '109.00'], 'reports.reports_case_1': ['60.42', '100.00'], 'reports.reports_case_2': ['69.16', '114.00'], 'reports.reports_case_3': ['69.16', '114.00'], 'reports.reports_case_4': ['66.04', '109.00'], 'reports.reports_case_5': ['72.90', '120.00'], 'subscriptions.subscriptions_case_0': ['72.90', '120.00'], 'subscriptions.subscriptions_case_1': ['60.42', '100.00'], 'subscriptions.subscriptions_case_2': ['66.04', '109.00'], 'subscriptions.subscriptions_case_3': ['69.78', '115.00'], 'subscriptions.subscriptions_case_4': ['60.42', '100.00'], 'subscriptions.subscriptions_case_5': ['66.04', '109.00'], 'coupons.coupons_case_0': ['60.42', '100.00'], 'coupons.coupons_case_1': ['66.04', '109.00'], 'coupons.coupons_case_2': ['66.04', '109.00'], 'coupons.coupons_case_3': ['66.04', '109.00'], 'coupons.coupons_case_4': ['75.40', '124.00'], 'coupons.coupons_case_5': ['66.04', '109.00'], 'shipping.shipping_case_0': ['66.04', '109.00'], 'shipping.shipping_case_1': ['71.03', '117.00'], 'shipping.shipping_case_2': ['71.03', '117.00'], 'shipping.shipping_case_3': ['72.90', '120.00'], 'shipping.shipping_case_4': ['60.42', '100.00'], 'shipping.shipping_case_5': ['66.04', '109.00'], 'wholesale.wholesale_case_0': ['72.90', '120.00'], 'wholesale.wholesale_case_1': ['71.66', '118.00'], 'wholesale.wholesale_case_2': ['66.04', '109.00'], 'wholesale.wholesale_case_3': ['71.66', '118.00'], 'wholesale.wholesale_case_4': ['72.90', '120.00'], 'wholesale.wholesale_case_5': ['72.90', '120.00'], 'pos.pos_case_0': ['72.28', '119.00'], 'pos.pos_case_1': ['72.28', '119.00'], 'pos.pos_case_2': ['75.40', '124.00'], 'pos.pos_case_3': ['60.42', '100.00'], 'pos.pos_case_4': ['66.04', '109.00'], 'pos.pos_case_5': ['72.28', '119.00'], 'exports.exports_case_0': ['72.90', '120.00'], 'exports.exports_case_1': ['60.42', '100.00'], 'exports.exports_case_2': ['72.90', '120.00'], 'exports.exports_case_3': ['72.90', '120.00'], 'exports.exports_case_4': ['75.40', '124.00'], 'exports.exports_case_5': ['66.04', '109.00'], 'audit.audit_case_0': ['66.04', '109.00'], 'audit.audit_case_1': ['75.40', '124.00'], 'audit.audit_case_2': ['66.04', '109.00'], 'audit.audit_case_3': ['60.42', '100.00'], 'audit.audit_case_4': ['72.90', '120.00'], 'audit.audit_case_5': ['66.04', '109.00']}
MODS = ['cart', 'checkout', 'invoice', 'refunds', 'reports', 'subscriptions', 'coupons', 'shipping', 'wholesale', 'pos', 'exports', 'audit']
HERE = os.path.dirname(os.path.abspath(__file__))


class Hidden(unittest.TestCase):
    def test_values_unchanged(self):
        for key, (a, b) in EXPECTED.items():
            mod, fn = key.split(".")
            f = getattr(importlib.import_module("shop." + mod), fn)
            with warnings.catch_warnings():
                warnings.simplefilter("error", DeprecationWarning)
                self.assertEqual(str(f([(19.99, 3), (5, 0), (0.35, 7)], 2)), a, key)
                self.assertEqual(str(f([(100, 1)])), b, key)

    def test_no_calc_total_left(self):
        for m in MODS:
            src = open(os.path.join(HERE, "shop", m + ".py")).read()
            self.assertNotIn("calc_total", src, m)
            self.assertIn("order_total", src, m)

    def test_keyword_only(self):
        from shop.money import order_total
        self.assertEqual(str(order_total([(10, 2)], tax_rate=0.5)), "30.00")
        with self.assertRaises(TypeError):
            order_total([(10, 2)], 0.5)

    def test_alias_warns(self):
        from shop.money import calc_total
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            self.assertEqual(str(calc_total([(10, 2)], 0.5)), "30.00")
        self.assertTrue(any(issubclass(x.category, DeprecationWarning) for x in w))

    def test_readme(self):
        self.assertIn("order_total", open(os.path.join(HERE, "README.md")).read())

    def test_visible_test_updated(self):
        self.assertIn("order_total", open(os.path.join(HERE, "tests", "test_money.py")).read())


if __name__ == "__main__":
    unittest.main()
