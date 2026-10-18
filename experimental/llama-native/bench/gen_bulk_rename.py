"""Generates bench/tasks/bulk-rename (deterministic): a 12-module package whose money API is renamed."""
import os, textwrap, random, shutil
random.seed(7)
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tasks", "bulk-rename")
shutil.rmtree(root, ignore_errors=True)
mods = ["cart", "checkout", "invoice", "refunds", "reports", "subscriptions", "coupons", "shipping", "wholesale", "pos", "exports", "audit"]
core = '''"""Money helpers shared by every shop module."""
from decimal import Decimal, ROUND_HALF_UP

CENT = Decimal("0.01")


def to_money(x):
    return Decimal(str(x)).quantize(CENT, rounding=ROUND_HALF_UP)


def calc_total(items, tax):
    """Total of (price, qty) pairs plus tax; tax is a fraction (0.2 = 20%)."""
    sub = sum((to_money(p) * q for p, q in items), Decimal("0"))
    return to_money(sub * (1 + Decimal(str(tax))))
'''
def module(name, i):
    fns = []
    for k in range(6):
        fn = f"{name}_case_{k}"
        tax = random.choice(["0.2", "0.09", "0", "0.24", "TAX"])
        taxexpr = "TAX" if tax == "TAX" else tax
        style = random.choice(["pos", "kw"])
        call = f"calc_total(items, {taxexpr})" if style == "pos" else f"calc_total(items, tax={taxexpr})"
        filler = "\n".join(f"    # step {j}: {random.choice(['normalise','validate','log','convert','round'])} the input" for j in range(random.randint(6, 14)))
        fns.append(f'''

def {fn}(items, discount=0):
    """{name} scenario {k}: total after an optional absolute discount."""
{filler}
    items = [(p, q) for p, q in items if q > 0]
    total = {call}
    return max(to_money(0), total - to_money(discount))
''')
    return f'''"""The {name} module."""
from shop.money import calc_total, to_money

TAX = 0.{i+10}
''' + "".join(fns)
os.makedirs(f"{root}/repo/shop"); os.makedirs(f"{root}/repo/tests"); os.makedirs(f"{root}/ref/shop")
open(f"{root}/repo/shop/__init__.py","w").write("")
open(f"{root}/repo/shop/money.py","w").write(core)
for i, m in enumerate(mods):
    open(f"{root}/repo/shop/{m}.py","w").write(module(m, i))
open(f"{root}/repo/README.md","w").write("# shop\n\nUse `shop.money.calc_total(items, tax)` to total a list of `(price, qty)` pairs.\n")
open(f"{root}/repo/tests/test_money.py","w").write('''import unittest
from shop.money import calc_total


class T(unittest.TestCase):
    def test_total(self):
        self.assertEqual(str(calc_total([(10, 2), (1.5, 1)], 0.2)), "25.80")


if __name__ == "__main__":
    unittest.main()
''')
open(f"{root}/issue.md","w").write('''API change in `shop` (all modules under `shop/`):

`shop.money.calc_total(items, tax)` becomes `shop.money.order_total(items, *, tax_rate)`:
the tax rate is keyword-only and renamed to `tax_rate`. Results must not change.

1. Add `order_total` and move every call site in every module of `shop/` to it
   (`order_total(items, tax_rate=...)`). No module other than `shop/money.py` may mention
   `calc_total` afterwards.
2. Keep `calc_total(items, tax)` in `shop/money.py` as a deprecated alias: it must emit a
   `DeprecationWarning` and return the same value as `order_total`.
3. `order_total` must raise `TypeError` when the tax rate is passed positionally.
4. Update README.md to document `order_total`, and update the existing test to use it.

Run the tests with: python3 -m unittest discover -s tests
''')
# reference: apply the change to a copy
import re
for i, m in enumerate(mods):
    s = module.__globals__  # unused
ref_core = core.replace('''def calc_total(items, tax):
    """Total of (price, qty) pairs plus tax; tax is a fraction (0.2 = 20%)."""
    sub = sum((to_money(p) * q for p, q in items), Decimal("0"))
    return to_money(sub * (1 + Decimal(str(tax))))''','''def order_total(items, *, tax_rate):
    """Total of (price, qty) pairs plus tax; tax_rate is a fraction (0.2 = 20%)."""
    sub = sum((to_money(p) * q for p, q in items), Decimal("0"))
    return to_money(sub * (1 + Decimal(str(tax_rate))))


def calc_total(items, tax):
    """Deprecated: use order_total(items, tax_rate=...)."""
    import warnings
    warnings.warn("calc_total is deprecated, use order_total", DeprecationWarning, stacklevel=2)
    return order_total(items, tax_rate=tax)''')
open(f"{root}/ref/shop/money.py","w").write(ref_core)
for m in mods:
    s = open(f"{root}/repo/shop/{m}.py").read()
    s = s.replace("from shop.money import calc_total, to_money", "from shop.money import order_total, to_money")
    s = re.sub(r"calc_total\(items, tax=([^)]*)\)", r"order_total(items, tax_rate=\1)", s)
    s = re.sub(r"calc_total\(items, ([^)]*)\)", r"order_total(items, tax_rate=\1)", s)
    open(f"{root}/ref/shop/{m}.py","w").write(s)
os.makedirs(f"{root}/ref/tests")
open(f"{root}/ref/tests/test_money.py","w").write(open(f"{root}/repo/tests/test_money.py").read().replace("calc_total","order_total").replace("0.2)", "tax_rate=0.2)"))
open(f"{root}/ref/README.md","w").write("# shop\n\nUse `shop.money.order_total(items, tax_rate=...)` to total a list of `(price, qty)` pairs.\n`calc_total` is deprecated.\n")
# hidden tests: expected values computed from the original implementation
exp = {}
import importlib, sys
sys.path.insert(0, f"{root}/repo")
for m in mods:
    mod = importlib.import_module(f"shop.{m}")
    for k in range(6):
        fn = getattr(mod, f"{m}_case_{k}")
        exp[f"{m}.{m}_case_{k}"] = [str(fn([(19.99, 3), (5, 0), (0.35, 7)], 2)), str(fn([(100, 1)]))]
sys.path.pop(0)
open(f"{root}/hidden_test.py","w").write(f'''import importlib, os, re, unittest, warnings

EXPECTED = {exp!r}
MODS = {mods!r}
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
''')
print("ok", sum(len(open(f"{root}/repo/shop/{m}.py").read()) for m in mods), "chars of modules")
