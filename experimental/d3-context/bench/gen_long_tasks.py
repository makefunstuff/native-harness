#!/usr/bin/env python3
"""Generates bench/tasks-long/: long, messy tickets where the agent's context really grows (big
logs, many modules, long specs, several separate fixes). Deterministic (fixed seeds).

Each task: issue.md, repo/ (the broken tree, with visible tests under tests/), ref/ (files that
fix it, overlaid on repo/), hidden_test.py (grades the final tree). bench/selftest.sh checks that
repo fails the hidden tests and repo+ref passes hidden and visible tests.

usage: bench/gen_long_tasks.py [TASK ...]   (default: all)
"""
import os, random, shutil, sys, textwrap

sys.dont_write_bytecode = True  # expected values import the fixture repos: keep __pycache__ out of them

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "tasks-long")


def D(s):
    return textwrap.dedent(s).lstrip("\n")


class Task:
    def __init__(self, name):
        self.name = name
        self.root = os.path.join(OUT, name)
        shutil.rmtree(self.root, ignore_errors=True)
        os.makedirs(self.root)

    def _w(self, rel, text):
        p = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", newline="") as f:
            f.write(text)

    def repo(self, rel, text):
        self._w(os.path.join("repo", rel), text)

    def ref(self, rel, text):
        self._w(os.path.join("ref", rel), text)

    def issue(self, text):
        self._w("issue.md", D(text))

    def hidden(self, text):
        self._w("hidden_test.py", D(text))


# ---------------------------------------------------------------------------------------------
# filler: plausible code an agent has to read past (it is never the bug)

VERBS = ["normalise", "validate", "summarise", "merge", "split", "render", "collect", "index", "score",
         "filter", "group", "convert", "resolve", "annotate", "flatten", "sanitize"]
NOUNS = ["record", "batch", "entry", "row", "payload", "header", "segment", "bucket", "window", "label",
         "event", "line", "item", "group", "field", "token"]


def filler_fn(rng, prefix, i):
    v, n = rng.choice(VERBS), rng.choice(NOUNS)
    name = f"{v}_{n}_{prefix}{i}"
    shape = rng.randrange(6)
    keys = rng.sample(["id", "name", "kind", "size", "owner", "tag", "status", "source", "weight", "note"], 3)
    if shape == 0:
        body = f'''
def {name}(rec, *, strict=False):
    """{v.capitalize()} one {n} (variant {i}). Missing keys are filled with defaults unless strict."""
    out = dict(rec)
    for key in {tuple(keys)!r}:
        if key not in out:
            if strict:
                raise KeyError(key)
            out[key] = None
    if isinstance(out.get("{keys[0]}"), str):
        out["{keys[0]}"] = out["{keys[0]}"].strip()
    return out
'''
    elif shape == 1:
        k = rng.randint(2, 9)
        body = f'''
def {name}(values, size={k}):
    """{v.capitalize()} {n}s into chunks of `size` (variant {i})."""
    if size <= 0:
        raise ValueError("size must be positive")
    chunk, out = [], []
    for value in values:
        chunk.append(value)
        if len(chunk) == size:
            out.append(tuple(chunk))
            chunk = []
    if chunk:
        out.append(tuple(chunk))
    return out
'''
    elif shape == 2:
        body = f'''
def {name}(items, key="{keys[1]}"):
    """Group {n}s by `key` (variant {i}); items without the key go under None."""
    groups = {{}}
    for item in items:
        groups.setdefault(item.get(key), []).append(item)
    return {{k: sorted(v, key=lambda x: str(x.get("{keys[2]}", ""))) for k, v in groups.items()}}
'''
    elif shape == 3:
        a, b = rng.randint(1, 9), rng.randint(10, 99)
        body = f'''
def {name}(text, limit={b}):
    """{v.capitalize()} a {n} label: collapse whitespace, cut to `limit` chars (variant {i})."""
    words = str(text).split()
    label = " ".join(words)
    if len(label) > limit:
        label = label[: max(0, limit - {a})].rstrip() + "~" * {a}
    return label
'''
    elif shape == 4:
        body = f'''
def {name}(counts):
    """Fraction of each {n} kind in `counts` (variant {i}); an empty input gives an empty dict."""
    total = sum(counts.values())
    if not total:
        return {{}}
    return {{k: round(c / total, 4) for k, c in sorted(counts.items())}}
'''
    else:
        body = f'''
class {v.capitalize()}{n.capitalize()}{prefix.capitalize()}{i}:
    """Small accumulator for {n}s (variant {i})."""

    def __init__(self):
        self.seen = []
        self.errors = 0

    def add(self, value):
        if value is None:
            self.errors += 1
            return False
        self.seen.append(value)
        return True

    def summary(self):
        return {{"count": len(self.seen), "errors": self.errors, "last": self.seen[-1] if self.seen else None}}
'''
    return body


def filler_module(rng, prefix, n, doc, imports="", core=""):
    parts = [f'"""{doc}"""\n', imports]
    fns = [filler_fn(rng, prefix, i) for i in range(n)]
    cut = rng.randint(n // 3, max(n // 3, 2 * n // 3))
    parts += fns[:cut] + ["\n" + core.strip("\n") + "\n"] + fns[cut:]
    return "\n".join(p for p in parts if p).rstrip() + "\n"


def filler_tests(rng, mod_import, names_and_kinds, cls="TestHelpers"):
    """Visible passing tests over some filler functions (makes the suite and its output bigger)."""
    out = [f"import unittest\nfrom {mod_import} import *  # noqa\n\n\nclass {cls}(unittest.TestCase):"]
    for nm, shape in names_and_kinds:
        out.append(f"    def test_{nm.lower()}(self):\n        self.assertTrue(callable({nm}))")
    return "\n".join(out) + "\n"


TASKS = {}


def task(fn):
    TASKS[fn.__name__.replace("_", "-")] = fn
    return fn


# ---------------------------------------------------------------------------------------------
@task
def ci_triage():
    """A red CI log (~5k lines) over a 10-module package; three bugs plus a deprecation."""
    t, rng = Task("ci-triage"), random.Random(11)
    mods = ["accounts", "audit", "export", "fx", "journal", "posting", "reconcile", "statements", "tax", "util"]
    core = {
        "fx": ("from decimal import Decimal, ROUND_HALF_UP\n", '''
def convert(amount, rate):
    """Convert `amount` at `rate`; the result is a Decimal rounded half-up to cents.

    Both arguments may be str, int or Decimal ("12.50", "1.0841")."""
    return Decimal(str(round(float(amount) * float(rate), 2)))
''', '''
def convert(amount, rate):
    """Convert `amount` at `rate`; the result is a Decimal rounded half-up to cents.

    Both arguments may be str, int or Decimal ("12.50", "1.0841")."""
    return (Decimal(str(amount)) * Decimal(str(rate))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
'''),
        "reconcile": ("from decimal import Decimal\n", '''
def match(bank, book):
    """Pair bank lines with book entries.

    Two lines match when their references are equal ignoring case and surrounding whitespace,
    and their amounts are equal to the cent. Each book entry is used at most once (first fit).
    Returns a list of (bank_index, book_index)."""
    pairs, used = [], set()
    for i, b in enumerate(bank):
        for j, e in enumerate(book):
            if j in used:
                continue
            if b["ref"] == e["ref"] and Decimal(str(b["amount"])) == Decimal(str(e["amount"])):
                pairs.append((i, j))
                used.add(j)
                break
    return pairs
''', '''
def _ref(s):
    return str(s).strip().lower()


def match(bank, book):
    """Pair bank lines with book entries.

    Two lines match when their references are equal ignoring case and surrounding whitespace,
    and their amounts are equal to the cent. Each book entry is used at most once (first fit).
    Returns a list of (bank_index, book_index)."""
    pairs, used = [], set()
    for i, b in enumerate(bank):
        for j, e in enumerate(book):
            if j in used:
                continue
            if _ref(b["ref"]) == _ref(e["ref"]) and Decimal(str(b["amount"])) == Decimal(str(e["amount"])):
                pairs.append((i, j))
                used.add(j)
                break
    return pairs
'''),
        "statements": ("from datetime import date, timedelta\nfrom .util import parse_date\n", '''
def period_bounds(year, month):
    """First and last day of a statement month, as dates."""
    start = date(year, month, 1)
    end = date(year, month + 1, 1) - timedelta(days=1)
    return start, end


def opening_date(text):
    """The opening date of a statement header ("2026-01-05")."""
    return parse_date(text)
''', '''
def period_bounds(year, month):
    """First and last day of a statement month, as dates."""
    start = date(year, month, 1)
    nxt = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, nxt - timedelta(days=1)


def opening_date(text):
    """The opening date of a statement header ("2026-01-05")."""
    return parse_iso_date(text)
'''),
        "util": ("import warnings\nfrom datetime import date\n", '''
def parse_iso_date(text):
    """Parse YYYY-MM-DD into a date."""
    y, m, d = (int(x) for x in str(text).strip().split("-"))
    return date(y, m, d)


def parse_date(text):
    """Deprecated: use parse_iso_date."""
    warnings.warn("ledger.util.parse_date is deprecated; use parse_iso_date", DeprecationWarning, stacklevel=2)
    return parse_iso_date(text)
''', None),
    }
    filler_names = {}
    for m in mods:
        imports, broken, fixed = core.get(m, ("", "", None))
        src = filler_module(rng, m[:3], 24, f"ledger.{m}: helpers for the {m} part of the ledger.", imports, broken)
        filler_names[m] = [l.split("(")[0][4:] for l in src.splitlines() if l.startswith("def ")]
        t.repo(f"ledger/{m}.py", src)
        if fixed:
            src_fixed = src.replace(broken.strip("\n"), fixed.strip("\n"))
            if m == "statements":
                src_fixed = src_fixed.replace("from .util import parse_date\n", "from .util import parse_iso_date\n")
            t.ref(f"ledger/{m}.py", src_fixed)
    t.repo("ledger/__init__.py", '"""A small double-entry ledger."""\n')
    t.repo("tests/__init__.py", "")
    # visible tests: real ones (three fail) + many trivial ones
    t.repo("tests/test_core.py", D('''
        import unittest, warnings
        from datetime import date
        from decimal import Decimal
        from ledger import fx, reconcile, statements


        class TestFx(unittest.TestCase):
            def test_convert_identity(self):
                self.assertEqual(fx.convert("12.50", "1"), Decimal("12.50"))

            def test_convert_half_up(self):
                self.assertEqual(fx.convert("2.675", "1"), Decimal("2.68"))


        class TestReconcile(unittest.TestCase):
            def test_exact(self):
                self.assertEqual(reconcile.match([{"ref": "A1", "amount": "5.00"}], [{"ref": "A1", "amount": "5"}]), [(0, 0)])

            def test_ref_case(self):
                self.assertEqual(reconcile.match([{"ref": "inv-77 ", "amount": "5.00"}], [{"ref": "INV-77", "amount": "5.00"}]), [(0, 0)])


        class TestStatements(unittest.TestCase):
            def test_june(self):
                self.assertEqual(statements.period_bounds(2026, 6), (date(2026, 6, 1), date(2026, 6, 30)))

            def test_december(self):
                self.assertEqual(statements.period_bounds(2026, 12), (date(2026, 12, 1), date(2026, 12, 31)))

            def test_opening(self):
                self.assertEqual(statements.opening_date("2026-01-05"), date(2026, 1, 5))
        '''))
    test_ids = [("test_convert_identity", "tests.test_core.TestFx", "ok"), ("test_convert_half_up", "tests.test_core.TestFx", "FAIL"),
                ("test_exact", "tests.test_core.TestReconcile", "ok"), ("test_ref_case", "tests.test_core.TestReconcile", "FAIL"),
                ("test_december", "tests.test_core.TestStatements", "ERROR"), ("test_june", "tests.test_core.TestStatements", "ok"),
                ("test_opening", "tests.test_core.TestStatements", "ok")]
    for m in mods:
        names = filler_names[m]
        body = [f"import unittest\nimport ledger.{m} as mod\n\n\nclass Test{m.capitalize()}(unittest.TestCase):"]
        for nm in names:
            body.append(f"    def test_{nm}(self):\n        self.assertTrue(callable(mod.{nm}))")
            test_ids.append((f"test_{nm}", f"tests.test_{m}.Test{m.capitalize()}", "ok"))
        t.repo(f"tests/test_{m}.py", "\n".join(body) + "\n")
    # the CI log
    L = []
    ts = [0]

    def log(s):
        ts[0] += rng.randint(1, 40)
        L.append(f"2026-10-17T08:{(ts[0] // 6000) % 60:02d}:{(ts[0] // 100) % 60:02d}.{ts[0] % 100:02d}Z {s}")
    log("Job 8812 (pipeline 2291, branch main, commit 4f1c9e2) started on runner ci-linux-07")
    for step in ["Checkout", "Set up Python 3.12.7", "Restore cache", "Install dependencies"]:
        log(f"##[group]{step}")
        for k in range(rng.randint(40, 90)):
            pkg = rng.choice(["certifi", "urllib3", "idna", "charset-normalizer", "requests", "packaging", "pyparsing",
                              "six", "attrs", "pluggy", "iniconfig", "tomli", "coverage", "wheel", "setuptools"])
            ver = f"{rng.randint(0, 30)}.{rng.randint(0, 20)}.{rng.randint(0, 9)}"
            log(rng.choice([f"Collecting {pkg}=={ver}", f"  Downloading {pkg}-{ver}-py3-none-any.whl ({rng.randint(10, 900)} kB)",
                            f"Requirement already satisfied: {pkg} in /opt/hostedtoolcache/Python/3.12.7/x64/lib/python3.12/site-packages ({ver})",
                            f"  Using cached {pkg}-{ver}.tar.gz", f"cache hit: key=pip-{rng.getrandbits(48):012x}"]))
        log("##[endgroup]")
    log("##[group]Run python -m unittest discover -s tests -v")
    rng.shuffle(test_ids)
    test_ids.sort(key=lambda x: x[1])
    for name, cls, res in test_ids:
        log(f"{name} ({cls}.{name}) ... {res}")
        if name == "test_opening":
            log("/home/runner/work/ledger/ledger/ledger/statements.py:" + str(rng.randint(80, 200)) +
                ": DeprecationWarning: ledger.util.parse_date is deprecated; use parse_iso_date")
            log("  return parse_date(text)")
    log("")
    log("======================================================================")
    log("ERROR: test_december (tests.test_core.TestStatements.test_december)")
    log("----------------------------------------------------------------------")
    log("Traceback (most recent call last):")
    log('  File "/home/runner/work/ledger/ledger/tests/test_core.py", line 28, in test_december')
    log("    self.assertEqual(statements.period_bounds(2026, 12), (date(2026, 12, 1), date(2026, 12, 31)))")
    log('  File "/home/runner/work/ledger/ledger/ledger/statements.py", line 120, in period_bounds')
    log("    end = date(year, month + 1, 1) - timedelta(days=1)")
    log("ValueError: month must be in 1..12")
    for nm, line, a, b, expr in [("test_convert_half_up (tests.test_core.TestFx.test_convert_half_up)", 13, "Decimal('2.67')", "Decimal('2.68')", 'self.assertEqual(fx.convert("2.675", "1"), Decimal("2.68"))'),
                                 ("test_ref_case (tests.test_core.TestReconcile.test_ref_case)", 21, "[]", "[(0, 0)]", 'self.assertEqual(reconcile.match([{"ref": "inv-77 ", "amount": "5.00"}], [{"ref": "INV-77", "amount": "5.00"}]), [(0, 0)])')]:
        log("======================================================================")
        log("FAIL: " + nm)
        log("----------------------------------------------------------------------")
        log("Traceback (most recent call last):")
        log(f'  File "/home/runner/work/ledger/ledger/tests/test_core.py", line {line}, in {nm.split()[0]}')
        log("    " + expr)
        log(f"AssertionError: {a} != {b}")
    log("")
    log("----------------------------------------------------------------------")
    log(f"Ran {len(test_ids)} tests in 0.{rng.randint(100, 999)}s")
    log("")
    log("FAILED (failures=2, errors=1)")
    log("##[error]Process completed with exit code 1.")
    log("##[endgroup]")
    for k in range(400):
        log(rng.choice(["Post job cleanup.", f"[command]/usr/bin/git config --local --unset-all http.https://github.com/.extraheader",
                        f"Cleaning up orphan processes", f"upload-artifact: skipped {rng.randint(1, 9)} files (retention 0)",
                        f"telemetry: span ci.step id={rng.getrandbits(32):08x} ok"]))
    t.repo("ci/job-8812.log", "\n".join(L) + "\n")
    t.repo("README.md", "# ledger\n\nA small double-entry ledger. Tests: `python3 -m unittest discover -s tests -v`.\n")
    t.issue('''
        CI job 8812 on `main` is red. The full job log is in `ci/job-8812.log` (CI runs
        `python -m unittest discover -s tests -v` on Python 3.12).

        - Fix every failing test by fixing the code in `ledger/`. The tests are correct: do not
          edit anything under `tests/`.
        - The log also shows a `DeprecationWarning` raised from inside our own package. Fix its
          cause in our code (do not silence the warning, and keep the deprecated function itself
          as it is: other teams still call it).
        - Keep public function names and signatures unchanged.

        When you are done the whole suite must pass with no warnings coming from `ledger/`.
        ''')
    t.hidden('''
        import unittest, warnings
        from datetime import date
        from decimal import Decimal
        from ledger import fx, reconcile, statements, util


        class Hidden(unittest.TestCase):
            def test_fx(self):
                for a, r, e in [("2.675", "1", "2.68"), ("10.125", "1", "10.13"), ("1.10", "1.2345", "1.36"),
                                ("100", "0.9123", "91.23"), (Decimal("0.005"), 1, "0.01"), (3, "1.5", "4.50")]:
                    self.assertEqual(fx.convert(a, r), Decimal(e), (a, r))
                self.assertIsInstance(fx.convert("1", "1"), Decimal)

            def test_reconcile(self):
                bank = [{"ref": " Inv-1", "amount": "10.00"}, {"ref": "inv-2", "amount": "3.5"}, {"ref": "X", "amount": "1"}]
                book = [{"ref": "INV-2", "amount": "3.50"}, {"ref": "inv-1 ", "amount": "10"}, {"ref": "x", "amount": "1.01"}]
                self.assertEqual(reconcile.match(bank, book), [(0, 1), (1, 0)])
                self.assertEqual(reconcile.match([{"ref": "a", "amount": "1"}, {"ref": "A", "amount": "1"}],
                                                 [{"ref": "a", "amount": "1"}]), [(0, 0)])

            def test_bounds(self):
                self.assertEqual(statements.period_bounds(2026, 12), (date(2026, 12, 1), date(2026, 12, 31)))
                self.assertEqual(statements.period_bounds(2024, 2), (date(2024, 2, 1), date(2024, 2, 29)))
                self.assertEqual(statements.period_bounds(2025, 1), (date(2025, 1, 1), date(2025, 1, 31)))

            def test_no_deprecation_from_package(self):
                with warnings.catch_warnings(record=True) as w:
                    warnings.simplefilter("always")
                    self.assertEqual(statements.opening_date("2026-01-05"), date(2026, 1, 5))
                self.assertEqual([x for x in w if issubclass(x.category, DeprecationWarning)], [])

            def test_deprecated_alias_kept(self):
                with warnings.catch_warnings(record=True) as w:
                    warnings.simplefilter("always")
                    self.assertEqual(util.parse_date("2026-03-04"), date(2026, 3, 4))
                self.assertTrue(any(issubclass(x.category, DeprecationWarning) for x in w))
        ''')



# ---------------------------------------------------------------------------------------------
@task
def prod_incidents():
    """A 9k-line production log with four distinct exceptions; the rules are in a long behaviour doc."""
    t, rng = Task("prod-incidents"), random.Random(22)
    mods = ["currency", "customers", "dates", "discounts", "invoice", "ledger_sync", "notify", "payments",
            "plans", "proration", "tax", "webhooks"]
    core = {
        "currency": ("import re\nfrom decimal import Decimal, ROUND_HALF_UP\n", '''
def parse_amount(text):
    """Parse a customer-entered amount into a Decimal with two places (see docs/behaviour.md, "Amounts")."""
    s = str(text).strip().replace(",", "")
    return Decimal(s).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
''', '''
def parse_amount(text):
    """Parse a customer-entered amount into a Decimal with two places (see docs/behaviour.md, "Amounts")."""
    s = str(text).strip().replace("\\u00a0", "").replace(" ", "")
    neg = s.startswith("-")
    s = s.lstrip("+-")
    m = re.search(r"[.,](\\d{1,2})$", s)
    if m:
        whole, frac = s[: m.start()], m.group(1)
    else:
        whole, frac = s, "0"
    whole = whole.replace(",", "").replace(".", "")
    if not whole.isdigit() and whole != "":
        raise ValueError(f"not an amount: {text!r}")
    if not whole and not m:
        raise ValueError(f"not an amount: {text!r}")
    v = Decimal(f"{whole or '0'}.{frac}").quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return -v if neg else v
'''),
        "dates": ("import calendar\nfrom datetime import date\n", '''
def add_months(d, n):
    """The same day `n` months later (see docs/behaviour.md, "Billing dates")."""
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, d.day)


def next_billing_date(anchor, periods):
    return add_months(anchor, periods)
''', '''
def add_months(d, n):
    """The same day `n` months later (see docs/behaviour.md, "Billing dates")."""
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def next_billing_date(anchor, periods):
    return add_months(anchor, periods)
'''),
        "discounts": ("from decimal import Decimal, ROUND_HALF_UP\n", '''
def unit_discount(total_discount, quantity):
    """Spread an order-level discount over the units (see docs/behaviour.md, "Discounts")."""
    per = Decimal(str(total_discount)) / Decimal(quantity)
    return per.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
''', '''
def unit_discount(total_discount, quantity):
    """Spread an order-level discount over the units (see docs/behaviour.md, "Discounts")."""
    if not quantity:
        return Decimal("0.00")
    per = Decimal(str(total_discount)) / Decimal(quantity)
    return per.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
'''),
        "invoice": ("", '''
def render_header(customer):
    """Header lines of an invoice (see docs/behaviour.md, "Invoice header")."""
    lines = [customer["name"], customer["address"]]
    lines.append(f"VAT ID: {customer['vat_id']}")
    lines.append(f"Customer no. {customer['id']}")
    return lines
''', '''
def render_header(customer):
    """Header lines of an invoice (see docs/behaviour.md, "Invoice header")."""
    lines = [customer["name"], customer["address"]]
    if (customer.get("vat_id") or "").strip():
        lines.append(f"VAT ID: {customer['vat_id'].strip()}")
    lines.append(f"Customer no. {customer['id']}")
    return lines
'''),
    }
    for m in mods:
        imports, broken, fixed = core.get(m, ("", "", None))
        src = filler_module(rng, m[:3], 22, f"billing.{m}.", imports, broken)
        t.repo(f"billing/{m}.py", src)
        if fixed:
            t.ref(f"billing/{m}.py", src.replace(broken.strip("\n"), fixed.strip("\n")))
    t.repo("billing/__init__.py", '"""Subscription billing."""\n')
    t.repo("tests/__init__.py", "")
    t.repo("tests/test_basic.py", D('''
        import unittest
        from datetime import date
        from decimal import Decimal
        from billing import currency, dates, discounts, invoice


        class Basic(unittest.TestCase):
            def test_amount(self):
                self.assertEqual(currency.parse_amount("12.5"), Decimal("12.50"))
                self.assertEqual(currency.parse_amount("1,234.56"), Decimal("1234.56"))

            def test_add_months(self):
                self.assertEqual(dates.add_months(date(2026, 1, 15), 1), date(2026, 2, 15))

            def test_discount(self):
                self.assertEqual(discounts.unit_discount("10", 4), Decimal("2.50"))

            def test_header(self):
                c = {"id": 7, "name": "Acme", "address": "1 Road", "vat_id": "EE100"}
                self.assertEqual(invoice.render_header(c), ["Acme", "1 Road", "VAT ID: EE100", "Customer no. 7"])
        '''))
    # behaviour doc: many sections, four of them matter
    words = ("customer plan invoice period renewal proration credit refund webhook retry ledger export "
             "notification currency rounding schedule grace trial upgrade downgrade cancel").split()
    sec = []
    rules = {
        "Amounts": "Amounts typed by customers come in local formats. Spaces and non-breaking spaces are thousands\n"
                   "separators. If the text ends in a `.` or `,` followed by one or two digits, that character is the\n"
                   "decimal separator and any other `.` or `,` is a thousands separator; otherwise there are no\n"
                   "decimals. `1 234,50`, `1.234,50`, `1,234.50` and `1234.5` are all 1234.50; `1.234` and `1,234` are 1234.00 (three digits after\n"
                   "the separator: thousands). A leading `-` makes the amount negative. Results have two places, rounded half-up.",
        "Billing dates": "A renewal `n` months after the anchor date falls on the same day of the month. When that\n"
                         "month is shorter, it falls on the month's last day (Jan 31 + 1 month = Feb 28, or Feb 29 in a\n"
                         "leap year). The anchor itself is not changed by this: Jan 31 + 2 months = Mar 31.",
        "Discounts": "An order-level discount is spread evenly over the units, rounded half-up to cents. An order\n"
                     "with zero units (a pure setup-fee order) gets a unit discount of 0.00; this is not an error.",
        "Invoice header": "The header is: name, address, `VAT ID: <id>` and `Customer no. <id>`, in that order. Private\n"
                          "customers have no VAT ID (the key is missing, None or blank): the VAT line is left out entirely.\n"
                          "Surrounding whitespace in the VAT ID is stripped.",
    }
    topics = [f"{rng.choice(words).capitalize()} {rng.choice(words)}s" for _ in range(40)]
    for i, title in enumerate(topics):
        para = []
        for _ in range(rng.randint(3, 6)):
            para.append(" ".join(rng.choice(words) for _ in range(rng.randint(14, 24))).capitalize() + ".")
        sec.append(f"## {i + 1}. {title}\n\n" + "\n".join(textwrap.wrap(" ".join(para), 96)) + "\n")
        if i in (6, 15, 23, 31):
            name = list(rules)[(6, 15, 23, 31).index(i)]
            sec.append(f"## {i + 1}a. {name}\n\n{rules[name]}\n")
    t.repo("docs/behaviour.md", "# Billing behaviour\n\nThe agreed behaviour of every billing component.\n\n" + "\n".join(sec))
    # the production log
    L = []
    sec_t = [0]

    def log(level, comp, msg):
        sec_t[0] += rng.randint(0, 3)
        s = sec_t[0]
        L.append(f"2026-10-17 {6 + s // 3600:02d}:{s // 60 % 60:02d}:{s % 60:02d},{rng.randint(0, 999):03d} {level:5s} [{comp}] {msg}")

    incidents = [
        ("billing.invoice", "POST /invoices/render", '{"customer": {"id": 4471, "name": "Mari Tamm", "address": "Pikk 3, Tallinn"}}',
         ['  File "/srv/billing/billing/invoice.py", line 141, in render_header', "    lines.append(f\"VAT ID: {customer['vat_id']}\")"], "KeyError: 'vat_id'"),
        ("billing.discounts", "POST /orders/quote", '{"order": 99812, "discount": "15.00", "quantity": 0, "items": [{"sku": "SETUP", "fee": "49.00"}]}',
         ['  File "/srv/billing/billing/discounts.py", line 88, in unit_discount', "    per = Decimal(str(total_discount)) / Decimal(quantity)"],
         "decimal.DivisionByZero: [<class 'decimal.DivisionByZero'>]"),
        ("billing.currency", "POST /payments/manual", '{"payment": 1203, "amount": "1 234,50", "currency": "EUR"}',
         ['  File "/srv/billing/billing/currency.py", line 63, in parse_amount', '    return Decimal(s).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)'],
         "decimal.InvalidOperation: [<class 'decimal.ConversionSyntax'>]"),
        ("billing.dates", "POST /subscriptions/renew", '{"subscription": 5520, "anchor": "2026-01-31", "periods": 1}',
         ['  File "/srv/billing/billing/dates.py", line 102, in next_billing_date', "    return add_months(anchor, periods)",
          '  File "/srv/billing/billing/dates.py", line 97, in add_months', "    return date(y, m, d.day)"], "ValueError: day is out of range for month"),
    ]
    comps = ["billing.api", "billing.webhooks", "billing.payments", "billing.notify", "billing.ledger_sync", "billing.plans", "gunicorn.access"]
    when = sorted(rng.sample(range(200, 8800), 11))
    for i in range(9000):
        if when and i == when[0]:
            when.pop(0)
            comp, route, payload, frames, exc = incidents[len(when) % 4]
            rid = f"{rng.getrandbits(40):010x}"
            log("INFO", "billing.api", f"{route} request_id={rid} payload={payload}")
            log("ERROR", comp, f"unhandled exception request_id={rid}")
            L.append("Traceback (most recent call last):")
            L.append('  File "/srv/billing/billing/api.py", line 212, in dispatch')
            L.append("    return handler(**payload)")
            L.extend(frames)
            L.append(exc)
            log("INFO", "gunicorn.access", f'10.0.{rng.randint(0, 9)}.{rng.randint(1, 250)} "{route} HTTP/1.1" 500 141')
            continue
        c = rng.choice(comps)
        if c == "gunicorn.access":
            log("INFO", c, f'10.0.{rng.randint(0, 9)}.{rng.randint(1, 250)} "{rng.choice(["GET", "POST"])} /{rng.choice(["plans", "invoices", "health", "customers", "webhooks/stripe"])}/{rng.randint(1, 9999)} HTTP/1.1" {rng.choice([200, 200, 200, 204, 304, 404])} {rng.randint(80, 9000)}')
        else:
            lvl = rng.choice(["INFO"] * 8 + ["DEBUG", "WARN"])
            msg = rng.choice([f"processed batch={rng.randint(1, 900)} size={rng.randint(1, 200)} in {rng.randint(1, 900)}ms",
                              f"retrying delivery id={rng.getrandbits(32):08x} attempt={rng.randint(1, 5)}",
                              f"cache miss key=plan:{rng.randint(1, 80)}", f"sync ok cursor={rng.getrandbits(36):09x}",
                              f"customer {rng.randint(1000, 9999)} updated fields=['email', 'address']",
                              f"slow query {rng.randint(200, 3000)}ms: SELECT * FROM invoices WHERE period = ${rng.randint(1, 3)}"])
            log(lvl, c, msg)
    t.repo("logs/billing-2026-10-17.log", "\n".join(L) + "\n")
    t.repo("README.md", "# billing\n\nSubscription billing service. Tests: `python3 -m unittest discover -s tests`.\n"
                        "Agreed behaviour: `docs/behaviour.md`.\n")
    t.issue('''
        Yesterday's production log `logs/billing-2026-10-17.log` has several 500s ("unhandled exception").
        Find every distinct exception in it and fix each one in `billing/`, following the agreed
        behaviour in `docs/behaviour.md` (the request payload is logged just before each traceback).
        Regression tests that replay the logged payloads, and the documented rules around them, will
        be run after your change. Keep the public functions and their signatures as they are, and keep
        the existing tests passing.
        ''')
    t.hidden('''
        import unittest
        from datetime import date
        from decimal import Decimal
        from billing import currency, dates, discounts, invoice


        class Hidden(unittest.TestCase):
            def test_header_without_vat(self):
                for c in ({"id": 4471, "name": "Mari Tamm", "address": "Pikk 3, Tallinn"},
                          {"id": 1, "name": "A", "address": "B", "vat_id": None}, {"id": 1, "name": "A", "address": "B", "vat_id": "  "}):
                    self.assertEqual(invoice.render_header(c), [c["name"], c["address"], f"Customer no. {c['id']}"])
                self.assertEqual(invoice.render_header({"id": 2, "name": "A", "address": "B", "vat_id": " EE1 "})[2], "VAT ID: EE1")

            def test_zero_quantity(self):
                self.assertEqual(discounts.unit_discount("15.00", 0), Decimal("0.00"))
                self.assertEqual(discounts.unit_discount("10", 3), Decimal("3.33"))

            def test_amounts(self):
                for s, e in [("1 234,50", "1234.50"), ("1.234,50", "1234.50"), ("1,234.50", "1234.50"), ("1234.5", "1234.50"),
                             ("1.234", "1234.00"), ("1,234", "1234.00"), ("12", "12.00"), ("-3,5", "-3.50"),
                             ("1\\u00a0000,05", "1000.05"), ("0,005", "5.00"), ("2.345.678,9", "2345678.90")]:
                    self.assertEqual(currency.parse_amount(s), Decimal(e), s)

            def test_month_end(self):
                self.assertEqual(dates.next_billing_date(date(2026, 1, 31), 1), date(2026, 2, 28))
                self.assertEqual(dates.add_months(date(2028, 1, 31), 1), date(2028, 2, 29))
                self.assertEqual(dates.add_months(date(2026, 1, 31), 2), date(2026, 3, 31))
                self.assertEqual(dates.add_months(date(2026, 8, 31), 13), date(2027, 9, 30))
                self.assertEqual(dates.add_months(date(2026, 3, 15), -1), date(2026, 2, 15))
        ''')



# ---------------------------------------------------------------------------------------------
@task
def wide_rename():
    """An API change over 28 modules (with filler), call sites in three syntactic forms."""
    import importlib, re
    t, rng = Task("wide-rename"), random.Random(33)
    mods = ["cart", "checkout", "invoice", "refunds", "reports", "subscriptions", "coupons", "shipping", "wholesale",
            "pos", "exports", "audit", "giftcards", "loyalty", "marketplace", "preorders", "quotes", "rentals",
            "returns", "bundles", "b2b", "kiosk", "events", "donations", "layaway", "tickets", "vouchers", "warranty"]
    money = D('''
        """Money helpers shared by every shop module."""
        from decimal import Decimal, ROUND_HALF_UP

        CENT = Decimal("0.01")


        def to_money(x):
            return Decimal(str(x)).quantize(CENT, rounding=ROUND_HALF_UP)


        def calc_total(items, tax):
            """Total of (price, qty) pairs plus tax; tax is a fraction (0.2 = 20%)."""
            sub = sum((to_money(p) * q for p, q in items), Decimal("0"))
            return to_money(sub * (1 + Decimal(str(tax))))
        ''')
    t.repo("shop/__init__.py", "")
    t.repo("shop/money.py", money)
    t.ref("shop/money.py", money.replace(D('''
        def calc_total(items, tax):
            """Total of (price, qty) pairs plus tax; tax is a fraction (0.2 = 20%)."""
            sub = sum((to_money(p) * q for p, q in items), Decimal("0"))
            return to_money(sub * (1 + Decimal(str(tax))))
        '''), D('''
        def order_total(items, *, tax_rate):
            """Total of (price, qty) pairs plus tax; tax_rate is a fraction (0.2 = 20%)."""
            sub = sum((to_money(p) * q for p, q in items), Decimal("0"))
            return to_money(sub * (1 + Decimal(str(tax_rate))))


        def calc_total(items, tax):
            """Deprecated: use order_total(items, tax_rate=...)."""
            import warnings
            warnings.warn("calc_total is deprecated, use order_total", DeprecationWarning, stacklevel=2)
            return order_total(items, tax_rate=tax)
        ''')))
    cases = {}
    for i, m in enumerate(mods):
        fns = []
        for k in range(5):
            tax = rng.choice(["0.2", "0.09", "0", "0.24", "TAX", "rate"])
            style = rng.choice(["pos", "kw", "multi"])
            call = {"pos": f"calc_total(items, {tax})", "kw": f"calc_total(items, tax={tax})",
                    "multi": f"calc_total(\n        items,\n        tax={tax},\n    )"}[style]
            fns.append(f'''

def {m}_case_{k}(items, discount=0, rate=0.2):
    """{m} scenario {k}: total after an optional absolute discount."""
    items = [(p, q) for p, q in items if q > 0]
    total = {call}
    return max(to_money(0), total - to_money(discount))
''')
            cases[f"{m}.{m}_case_{k}"] = None
        src = filler_module(rng, m[:3], 14, f"The {m} module.", f"from shop.money import calc_total, to_money\n\nTAX = 0.{i + 10}\n",
                            "".join(fns))
        t.repo(f"shop/{m}.py", src)
        s = src.replace("from shop.money import calc_total, to_money", "from shop.money import order_total, to_money")
        s = re.sub(r"calc_total\(\n        items,\n        tax=([^,]*),\n    \)", r"order_total(items, tax_rate=\1)", s)
        s = re.sub(r"calc_total\(items, tax=([^)]*)\)", r"order_total(items, tax_rate=\1)", s)
        s = re.sub(r"calc_total\(items, ([^)]*)\)", r"order_total(items, tax_rate=\1)", s)
        t.ref(f"shop/{m}.py", s)
    t.repo("README.md", "# shop\n\nUse `shop.money.calc_total(items, tax)` to total a list of `(price, qty)` pairs.\n")
    t.ref("README.md", "# shop\n\nUse `shop.money.order_total(items, tax_rate=...)` to total a list of `(price, qty)` pairs.\n`calc_total` is deprecated.\n")
    test = D('''
        import unittest
        from shop.money import calc_total


        class T(unittest.TestCase):
            def test_total(self):
                self.assertEqual(str(calc_total([(10, 2), (1.5, 1)], 0.2)), "25.80")
        ''')
    t.repo("tests/__init__.py", "")
    t.repo("tests/test_money.py", test)
    t.ref("tests/test_money.py", test.replace("calc_total", "order_total").replace("0.2)", "tax_rate=0.2)"))
    # expected values from the original code
    sys.path.insert(0, os.path.join(t.root, "repo"))
    for key in cases:
        mod, fn = key.split(".")
        f = getattr(importlib.import_module("shop." + mod), fn)
        cases[key] = [str(f([(19.99, 3), (5, 0), (0.35, 7)], 2)), str(f([(100, 1)])), str(f([(10, 1)], 0, 0.5))]
    sys.path.pop(0)
    for k in list(sys.modules):
        if k == "shop" or k.startswith("shop."):
            del sys.modules[k]
    t.issue('''
        API change in `shop` (all modules under `shop/`):

        `shop.money.calc_total(items, tax)` becomes `shop.money.order_total(items, *, tax_rate)`:
        the tax rate is keyword-only and renamed to `tax_rate`. Results must not change.

        1. Add `order_total` and move every call site in every module of `shop/` to it
           (`order_total(items, tax_rate=...)`). No module other than `shop/money.py` may mention
           `calc_total` afterwards. Review each module: call sites are written in several styles.
        2. Keep `calc_total(items, tax)` in `shop/money.py` as a deprecated alias: it must emit a
           `DeprecationWarning` and return the same value as `order_total`.
        3. `order_total` must raise `TypeError` when the tax rate is passed positionally.
        4. Update README.md to document `order_total`, and update the existing test to use it.

        Run the tests with: python3 -m unittest discover -s tests
        ''')
    t.hidden(f'''
        import importlib, os, unittest, warnings

        EXPECTED = {cases!r}
        MODS = {mods!r}
        HERE = os.path.dirname(os.path.abspath(__file__))


        class Hidden(unittest.TestCase):
            def test_values_unchanged(self):
                for key, (a, b, c) in EXPECTED.items():
                    mod, fn = key.split(".")
                    f = getattr(importlib.import_module("shop." + mod), fn)
                    with warnings.catch_warnings():
                        warnings.simplefilter("error", DeprecationWarning)
                        self.assertEqual(str(f([(19.99, 3), (5, 0), (0.35, 7)], 2)), a, key)
                        self.assertEqual(str(f([(100, 1)])), b, key)
                        self.assertEqual(str(f([(10, 1)], 0, 0.5)), c, key)

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

            def test_readme_and_test(self):
                self.assertIn("order_total", open(os.path.join(HERE, "README.md")).read())
                self.assertIn("order_total", open(os.path.join(HERE, "tests", "test_money.py")).read())
        ''')



# ---------------------------------------------------------------------------------------------
FAKE_V2 = '''
"""In-memory fake of the Pantry API v2 (from the platform team). Records every request."""
import json


class FakeV2:
    def __init__(self):
        self.calls = []
        self.accounts = {str(i): {"id": i, "display_name": f"user{i}", "created_at": f"2026-0{1 + i % 9}-0{1 + i % 9}T1{i % 10}:00:00+03:00"}
                         for i in range(1, 251)}
        self.orders = {str(i): {"id": i, "total": f"{i}.50", "status": "open" if i % 3 else "shipped",
                                "created_at": "2026-10-01T00:30:00-04:00"} for i in range(1, 121)}

    def request(self, method, path, *, params=None, json=None, headers=None):
        self.calls.append((method, path, dict(params or {}), json, dict(headers or {})))
        if (headers or {}).get("X-Api-Version") != "2":
            return 400, {"error": "missing X-Api-Version: 2"}
        parts = path.strip("/").split("/")
        if parts[0] != "v2":
            return 404, {"error": "unknown path"}
        parts = parts[1:]
        params = params or {}
        if parts[0] == "accounts":
            if len(parts) == 1 and method == "GET":
                return 200, self._page(list(self.accounts.values()), params)
            acc = self.accounts.get(parts[1])
            if acc is None:
                return 404, {"error": "no such account"}
            if method == "GET":
                return 200, dict(acc)
            if method == "PATCH":
                if set(json or {}) != {"display_name"}:
                    return 422, {"error": "unknown field"}
                acc["display_name"] = json["display_name"]
                return 200, dict(acc)
        if parts[0] == "orders":
            if len(parts) == 1 and method == "GET":
                rows = [o for o in self.orders.values() if not params.get("status") or o["status"] == params["status"]]
                return 200, self._page(rows, params)
            o = self.orders.get(parts[1])
            if o is None:
                return 404, {"error": "no such order"}
            if len(parts) == 2 and method == "GET":
                return 200, dict(o)
            if len(parts) == 3 and parts[2] == "cancel" and method == "POST":
                if not (json or {}).get("reason"):
                    return 422, {"error": "reason required"}
                o["status"] = "cancelled"
                return 200, {"cancelled": True}
        return 404, {"error": "unknown path"}

    def _page(self, rows, params):
        if "page" in params or "per_page" in params:
            return 400, {"error": "page/per_page were removed in v2"}
        limit = int(params.get("limit", 20))
        if limit > 100:
            return 422, {"error": "limit must be <= 100"}
        start = int(params.get("cursor") or 0)
        chunk = rows[start:start + limit]
        nxt = str(start + limit) if start + limit < len(rows) else None
        return {"items": chunk, "next_cursor": nxt}
'''


@task
def api_v2_migration():
    """Move a client library from API v1 to v2; the changes are spread through a 1.3k-line changelog."""
    t, rng = Task("api-v2-migration"), random.Random(44)
    api = D('''
        """Client core: wraps a transport (anything with .request(method, path, params=, json=, headers=))."""

        PREFIX = "/v1"


        class ApiError(Exception):
            def __init__(self, status, body):
                super().__init__(f"HTTP {status}: {body}")
                self.status, self.body = status, body


        class Client:
            def __init__(self, transport, token="test"):
                self.transport = transport
                self.token = token

            def call(self, method, path, *, params=None, json=None, ok=(200,)):
                headers = {"Authorization": f"Bearer {self.token}"}
                status, body = self.transport.request(method, PREFIX + path, params=params, json=json, headers=headers)
                if status not in ok:
                    raise ApiError(status, body)
                return body
        ''')
    api_ref = api.replace('PREFIX = "/v1"', 'PREFIX = "/v2"').replace(
        'headers = {"Authorization": f"Bearer {self.token}"}', 'headers = {"Authorization": f"Bearer {self.token}", "X-Api-Version": "2"}')
    util = D('''
        from datetime import datetime, timezone


        def from_epoch_ms(ms):
            """API v1 timestamps (epoch milliseconds) -> aware UTC datetime."""
            return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
        ''')
    util_ref = util + D('''


        def from_iso(text):
            """API v2 timestamps (ISO 8601 with offset) -> aware UTC datetime."""
            return datetime.fromisoformat(text).astimezone(timezone.utc)
        ''')
    users = ("from .util import from_epoch_ms\n", D('''
        def _user(raw):
            return {"id": raw["id"], "user_name": raw["user_name"], "created": from_epoch_ms(raw["created"])}


        def get_user(client, user_id):
            """One user: {"id", "user_name", "created" (aware UTC datetime)}."""
            return _user(client.call("GET", f"/users/{user_id}"))


        def list_users(client):
            """Every user, in server order."""
            out, page = [], 1
            while True:
                rows = client.call("GET", "/users", params={"page": page, "per_page": 50})
                if not rows:
                    return out
                out.extend(_user(r) for r in rows)
                page += 1


        def rename_user(client, user_id, new_name):
            """Change a user's name; returns the updated user."""
            return _user(client.call("PATCH", f"/users/{user_id}", json={"user_name": new_name}))
        '''), D('''
        def _user(raw):
            return {"id": raw["id"], "user_name": raw["display_name"], "created": from_iso(raw["created_at"])}


        def get_user(client, user_id):
            """One user: {"id", "user_name", "created" (aware UTC datetime)}."""
            return _user(client.call("GET", f"/accounts/{user_id}"))


        def list_users(client):
            """Every user, in server order."""
            out, cursor = [], None
            while True:
                params = {"limit": 100}
                if cursor:
                    params["cursor"] = cursor
                body = client.call("GET", "/accounts", params=params)
                out.extend(_user(r) for r in body["items"])
                cursor = body.get("next_cursor")
                if not cursor:
                    return out


        def rename_user(client, user_id, new_name):
            """Change a user's name; returns the updated user."""
            return _user(client.call("PATCH", f"/accounts/{user_id}", json={"display_name": new_name}))
        '''))
    orders = ("from .util import from_epoch_ms\n", D('''
        def _order(raw):
            return {"id": raw["id"], "total": raw["total"], "status": raw["status"], "created": from_epoch_ms(raw["created"])}


        def get_order(client, order_id):
            return _order(client.call("GET", f"/orders/{order_id}"))


        def list_orders(client, status=None):
            """Every order, optionally only those with `status`."""
            out, page = [], 1
            while True:
                params = {"page": page, "per_page": 50}
                if status:
                    params["status"] = status
                rows = client.call("GET", "/orders", params=params)
                if not rows:
                    return out
                out.extend(_order(r) for r in rows)
                page += 1


        def cancel_order(client, order_id, reason="customer_request"):
            """Cancel an order; True on success."""
            client.call("DELETE", f"/orders/{order_id}", ok=(204,))
            return True
        '''), D('''
        def _order(raw):
            return {"id": raw["id"], "total": raw["total"], "status": raw["status"], "created": from_iso(raw["created_at"])}


        def get_order(client, order_id):
            return _order(client.call("GET", f"/orders/{order_id}"))


        def list_orders(client, status=None):
            """Every order, optionally only those with `status`."""
            out, cursor = [], None
            while True:
                params = {"limit": 100}
                if status:
                    params["status"] = status
                if cursor:
                    params["cursor"] = cursor
                body = client.call("GET", "/orders", params=params)
                out.extend(_order(r) for r in body["items"])
                cursor = body.get("next_cursor")
                if not cursor:
                    return out


        def cancel_order(client, order_id, reason="customer_request"):
            """Cancel an order; True on success."""
            body = client.call("POST", f"/orders/{order_id}/cancel", json={"reason": reason})
            return bool(body.get("cancelled"))
        '''))
    t.repo("pantry/__init__.py", '"""Client for the Pantry API."""\n')
    t.repo("pantry/api.py", api)
    t.ref("pantry/api.py", api_ref)
    t.repo("pantry/util.py", util)
    t.ref("pantry/util.py", util_ref)
    for name, (imp, broken, fixed) in {"users": users, "orders": orders}.items():
        src = filler_module(rng, name[:3], 16, f"pantry.{name}: the {name} endpoints.", imp, broken)
        t.repo(f"pantry/{name}.py", src)
        t.ref(f"pantry/{name}.py", src.replace(broken.strip("\n"), fixed.strip("\n")).replace("from .util import from_epoch_ms", "from .util import from_iso"))
    for name in ["catalog", "inventory", "webhooks", "reports", "shipping", "billing"]:
        t.repo(f"pantry/{name}.py", filler_module(rng, name[:3], 18, f"pantry.{name}: local helpers for {name} data (no API calls).", "", ""))
    t.repo("tests/__init__.py", "")
    t.repo("tests/fake_v2.py", FAKE_V2.lstrip())
    t.repo("tests/test_v2_smoke.py", D('''
        import unittest
        from datetime import datetime, timezone
        from pantry.api import Client
        from pantry import users
        from tests.fake_v2 import FakeV2


        class Smoke(unittest.TestCase):
            def test_get_user(self):
                u = users.get_user(Client(FakeV2()), 3)
                self.assertEqual(u["user_name"], "user3")
                self.assertEqual(u["created"], datetime(2026, 4, 4, 10, 0, tzinfo=timezone.utc))
        '''))
    # the changelog: ~20 releases of noise, v2.0.0 holds the breaking changes, a few also hidden in 2.0.1
    words = ("endpoint field response request header webhook retry limit pagination token scope account order "
             "invoice report export catalog sku inventory latency error docs sdk").split()
    rel = []
    for minor in range(0, 22):
        ver = f"1.{minor}.0"
        lines = [f"## {ver} (2025-{1 + minor % 12:02d}-{1 + minor:02d})", ""]
        for sect in ["Added", "Changed", "Fixed"]:
            lines += [f"### {sect}", ""]
            for _ in range(rng.randint(5, 14)):
                lines.append(f"- {' '.join(rng.choice(words) for _ in range(rng.randint(6, 16))).capitalize()} (#{rng.randint(100, 4000)}).")
            lines.append("")
        rel.append("\n".join(lines))
    v2 = D('''
        ## 2.0.0 (2026-09-01)

        API v2. v1 is retired on 2026-11-01: every client must move. Breaking changes:

        ### Changed

        - All paths now start with `/v2/` instead of `/v1/`.
        - Every request must carry the header `X-Api-Version: 2`. Requests without it get HTTP 400.
        - Users are now called accounts: `/users` and `/users/{id}` are now `/accounts` and
          `/accounts/{id}`. The `user_name` field of an account is now `display_name` (in responses
          and in PATCH bodies).
        - Timestamps: the `created` field (epoch milliseconds) is replaced by `created_at`, an ISO 8601
          string with a UTC offset (for example `2026-10-01T00:30:00-04:00`). Applies to accounts and orders.
        - Cancelling an order is `POST /orders/{id}/cancel` with a JSON body `{"reason": "<text>"}`
          (reason required), answering 200 `{"cancelled": true}`. `DELETE /orders/{id}` is gone.
        - Search results are ranked by relevance by default (`sort=relevance`).
        - Error bodies are `{"error": "<message>"}` everywhere.

        ### Removed

        - `GET /v1/legacy/export` (use the reports API).
        - The `X-Request-Source` header is ignored.

        ''')
    v201 = D('''
        ## 2.0.1 (2026-09-15)

        ### Changed

        - Pagination (all list endpoints): `page` and `per_page` are replaced by cursors. Send `limit`
          (default 20, at most 100) and, for every page after the first, the `cursor` from the previous
          response. A list response is now an object `{"items": [...], "next_cursor": "<cursor>" | null}`;
          `next_cursor` is null on the last page. Sending `page`/`per_page` is an HTTP 400.
          (2.0.0 listed this under "Planned"; it shipped in 2.0.1.)

        ### Fixed

        - Docs: typo fixes in the webhooks guide (#4120).
        - `limit=0` returned every row; now HTTP 422 (#4133).

        ''')
    body = "# Pantry API changelog\n\nNewest first.\n\n" + rel[-1] + "\n" + v201 + "\n" + rel[-2] + "\n" + v2 + "\n" + "\n".join(reversed(rel[:-2]))
    t.repo("docs/CHANGELOG.md", body)
    t.repo("README.md", "# pantry\n\nPython client for the Pantry API. `pantry.users`, `pantry.orders`; tests: `python3 -m unittest discover -s tests`.\n")
    t.issue('''
        The Pantry API v1 is retired on 2026-11-01. Move our client library (`pantry/`) to API v2.
        Everything that changed is in the provider's changelog `docs/CHANGELOG.md` (read the 2.x
        releases carefully; they are not all in one place). `tests/fake_v2.py` is the platform
        team's fake v2 server; use it in tests.

        - Every public function in `pantry/users.py` and `pantry/orders.py` keeps its name, signature and
          return values: callers must not notice the move (for example a user dict still has the key
          `user_name`, and `created` is still an aware UTC datetime).
        - List functions must return every row, however many pages there are.
        - Do not change `tests/fake_v2.py`. Add tests of your own for what you changed.
        ''')
    t.hidden('''
        import unittest
        from datetime import datetime, timezone
        from pantry.api import Client
        from pantry import users, orders
        from tests.fake_v2 import FakeV2


        class Hidden(unittest.TestCase):
            def setUp(self):
                self.fake = FakeV2()
                self.c = Client(self.fake)

            def test_header_and_prefix(self):
                users.get_user(self.c, 1)
                orders.get_order(self.c, 1)
                for m, p, params, js, h in self.fake.calls:
                    self.assertTrue(p.startswith("/v2/"), p)
                    self.assertEqual(h.get("X-Api-Version"), "2")

            def test_user(self):
                u = users.get_user(self.c, 12)
                self.assertEqual(u, {"id": 12, "user_name": "user12", "created": datetime(2026, 4, 4, 9, 0, tzinfo=timezone.utc)})

            def test_list_users_all_pages(self):
                us = users.list_users(self.c)
                self.assertEqual(len(us), 250)
                self.assertEqual([u["id"] for u in us], list(range(1, 251)))
                self.assertTrue(all(c[2].get("limit", 20) <= 100 for c in self.fake.calls))

            def test_rename(self):
                u = users.rename_user(self.c, 5, "Mari")
                self.assertEqual(u["user_name"], "Mari")
                self.assertEqual(self.fake.accounts["5"]["display_name"], "Mari")

            def test_orders(self):
                o = orders.get_order(self.c, 7)
                self.assertEqual(o["created"], datetime(2026, 10, 1, 4, 30, tzinfo=timezone.utc))
                self.assertEqual(o["status"], "open")
                shipped = orders.list_orders(self.c, status="shipped")
                self.assertEqual(len(shipped), 40)
                self.assertEqual(len(orders.list_orders(self.c)), 120)

            def test_cancel(self):
                self.assertTrue(orders.cancel_order(self.c, 8))
                self.assertEqual(self.fake.orders["8"]["status"], "cancelled")
                m, p, params, js, h = self.fake.calls[-1]
                self.assertEqual((m, p, js), ("POST", "/v2/orders/8/cancel", {"reason": "customer_request"}))
                self.assertTrue(orders.cancel_order(self.c, 9, reason="fraud"))
                self.assertEqual(self.fake.calls[-1][3], {"reason": "fraud"})
        ''')



# ---------------------------------------------------------------------------------------------
def _corpus(seed, n, words=None):
    r = random.Random(seed)
    vocab = words or [f"w{i}" for i in range(3000)] + ["alpha", "beta", "gamma", "delta", "kernel", "cache", "router", "token"]
    return [(f"d{i:05d}", " ".join(r.choice(vocab[: 50 + r.randrange(len(vocab) - 50)]) for _ in range(r.randint(10, 50)))) for i in range(n)]


@task
def perf_hotspots():
    """A slow search index; a 1.6k-line profile points at three quadratic spots in a 14-module package."""
    import importlib
    t, rng = Task("perf-hotspots"), random.Random(55)
    tok = D('''
        """Tokeniser."""
        import re

        STOP = {"the", "a", "an", "of", "and", "or", "to", "in"}
        WORD = re.compile(r"[a-z0-9]+")


        def tokenize(text):
            return [w for w in WORD.findall(str(text).lower()) if w not in STOP]
        ''')
    dedupe = ("", D('''
        def unique_tokens(tokens):
            """The distinct tokens, in order of first appearance."""
            out = []
            for t in tokens:
                if t not in out:
                    out.append(t)
            return out
        '''), D('''
        def unique_tokens(tokens):
            """The distinct tokens, in order of first appearance."""
            return list(dict.fromkeys(tokens))
        '''))
    index = ("from .tokenize import tokenize\nfrom .dedupe import unique_tokens\n", D('''
        def build(docs):
            """Inverted index of (doc_id, text) pairs: {"postings": {token: [(doc_id, tf), ...] sorted by doc_id},
            "lengths": {doc_id: number of tokens}}."""
            postings = {}
            lengths = {}
            for doc_id, text in docs:
                toks = tokenize(text)
                lengths[doc_id] = len(toks)
                for tok in unique_tokens(toks):
                    tf = toks.count(tok)
                    lst = postings.setdefault(tok, [])
                    lst.append((doc_id, tf))
                    lst.sort()
            return {"postings": postings, "lengths": lengths}
        '''), D('''
        def build(docs):
            """Inverted index of (doc_id, text) pairs: {"postings": {token: [(doc_id, tf), ...] sorted by doc_id},
            "lengths": {doc_id: number of tokens}}."""
            from collections import Counter
            postings = {}
            lengths = {}
            for doc_id, text in docs:
                toks = tokenize(text)
                lengths[doc_id] = len(toks)
                for tok, tf in Counter(toks).items():
                    postings.setdefault(tok, []).append((doc_id, tf))
            for lst in postings.values():
                lst.sort()
            return {"postings": postings, "lengths": lengths}
        '''))
    rank = ("import math\nfrom .tokenize import tokenize\nfrom .dedupe import unique_tokens\n", D('''
        def idf(index, tok):
            n = len(index["lengths"])
            df = len(index["postings"].get(tok, []))
            return math.log((n + 1) / (df + 1)) + 1


        def search(index, query, k=10):
            """Top k (doc_id, score) for `query`, best first; ties by doc_id."""
            q = unique_tokens(tokenize(query))
            scores = {}
            for doc_id in index["lengths"]:
                s = 0.0
                for tok in q:
                    for d, tf in index["postings"].get(tok, []):
                        if d == doc_id:
                            s += tf / index["lengths"][doc_id] * idf(index, tok)
                if s > 0:
                    scores[doc_id] = s
            return sorted(scores.items(), key=lambda x: (-x[1], x[0]))[:k]
        '''), D('''
        def idf(index, tok):
            n = len(index["lengths"])
            df = len(index["postings"].get(tok, []))
            return math.log((n + 1) / (df + 1)) + 1


        def search(index, query, k=10):
            """Top k (doc_id, score) for `query`, best first; ties by doc_id."""
            q = unique_tokens(tokenize(query))
            scores = {}
            for tok in q:
                w = idf(index, tok)
                for d, tf in index["postings"].get(tok, []):
                    scores[d] = scores.get(d, 0.0) + tf / index["lengths"][d] * w
            scores = {d: s for d, s in scores.items() if s > 0}
            return sorted(scores.items(), key=lambda x: (-x[1], x[0]))[:k]
        '''))
    t.repo("search/__init__.py", '"""Small full-text search."""\n')
    t.repo("search/tokenize.py", tok)
    for name, (imp, broken, fixed) in {"dedupe": dedupe, "index": index, "rank": rank}.items():
        src = filler_module(rng, name[:3], 16, f"search.{name}.", imp, broken)
        t.repo(f"search/{name}.py", src)
        t.ref(f"search/{name}.py", src.replace(broken.strip("\n"), fixed.strip("\n")))
    others = ["highlight", "snippets", "facets", "spell", "synonyms", "stemming", "storage", "metrics", "cli", "config"]
    for name in others:
        t.repo(f"search/{name}.py", filler_module(rng, name[:3], 18, f"search.{name}.", "", ""))
    t.repo("tests/__init__.py", "")
    t.repo("tests/test_search.py", D('''
        import unittest
        from search.index import build
        from search.rank import search
        from search.dedupe import unique_tokens


        class T(unittest.TestCase):
            def test_small(self):
                idx = build([("a", "kernel cache cache"), ("b", "cache router"), ("c", "the of and")])
                self.assertEqual(idx["postings"]["cache"], [("a", 2), ("b", 1)])
                self.assertEqual(idx["lengths"], {"a": 3, "b": 2, "c": 0})
                self.assertEqual([d for d, s in search(idx, "cache")], ["a", "b"])

            def test_unique(self):
                self.assertEqual(unique_tokens(["b", "a", "b", "c", "a"]), ["b", "a", "c"])
        '''))
    # expected results from the original code on a small corpus
    sys.path.insert(0, os.path.join(t.root, "repo"))
    build = importlib.import_module("search.index").build
    srch = importlib.import_module("search.rank").search
    small = _corpus(5, 400)
    idx = build(small)
    queries = ["alpha beta", "kernel cache router", "w1 w2 w3 w17", "token gamma w99", "delta", "w5 alpha w5"]
    expected = {q: srch(idx, q) for q in queries}
    sys.path.pop(0)
    for k in list(sys.modules):
        if k == "search" or k.startswith("search."):
            del sys.modules[k]
    # the profile
    fns = []
    for name in ["dedupe", "index", "rank", "tokenize"] + others:
        src = open(os.path.join(t.root, "repo", "search", name + ".py")).read()
        for i, line in enumerate(src.splitlines(), 1):
            if line.startswith("def "):
                fns.append((f"{name}.py", i, line[4:].split("(")[0]))
    rows = []
    for f, ln, fn in fns:
        rows.append((rng.random() * 0.05, rng.randint(1, 4000), f"{f}:{ln}({fn})"))
    def where(f, fn):
        return next(f"{a}:{b}({c})" for a, b, c in fns if a == f and c == fn)
    rows += [(512.4, 50000, where("index.py", "build")), (231.9, 1834201, "{method 'sort' of 'list' objects}"),
             (190.2, 1834201, "{method 'count' of 'list' objects}"), (95.1, 1834201, where("dedupe.py", "unique_tokens")),
             (88.7, 200, where("rank.py", "search")), (40.3, 912833012, where("rank.py", "idf")),
             (2.1, 50000, where("tokenize.py", "tokenize")), (1.3, 50000, "{method 'findall' of 're.Pattern' objects}")]
    for _ in range(900):
        rows.append((rng.random() * 0.01, rng.randint(1, 900),
                     rng.choice(["{built-in method builtins.len}", "{built-in method builtins.isinstance}", "{method 'get' of 'dict' objects}",
                                 "{method 'append' of 'list' objects}", "{built-in method posix.stat}"]) if rng.random() < 0.2 else
                     f"/usr/lib/python3.12/{rng.choice(['json/decoder.py', 'json/encoder.py', 're/_parser.py', 're/_compiler.py', 'logging/__init__.py', 'pathlib.py', 'os.py', 'functools.py', 'enum.py', 'typing.py', 'abc.py'])}:{rng.randint(10, 1500)}({rng.choice(['decode', 'encode', 'parse', 'compile', '_get', 'emit', 'stat', 'wrapper', '__call__', 'inner', '__instancecheck__', 'isEnabledFor'])})"))
    rng.shuffle(rows)
    out = ["Reindex of 50000 documents + 200 benchmark queries (python -m cProfile -s filename nightly_reindex.py)", "",
           f"         {sum(r[1] for r in rows)} function calls ({rng.randint(10**6, 10**7)} primitive calls) in 1162.811 seconds", "",
           "   Ordered by: file name", "", "   ncalls  tottime  percall  cumtime  percall filename:lineno(function)"]
    rows.sort(key=lambda r: r[2])
    for tt, nc, loc in rows:
        cum = tt * (1 + rng.random())
        out.append(f"{nc:>9} {tt:8.3f} {tt / nc:8.3f} {cum:8.3f} {cum / nc:8.3f} {loc}")
    t.repo("profile/nightly-reindex.txt", "\n".join(out) + "\n")
    t.repo("README.md", "# search\n\nA small full-text search library (`search.index.build`, `search.rank.search`).\n")
    t.issue('''
        The nightly reindex of our 50k-document corpus now takes almost 20 minutes and queries are
        slow too. A profile of last night's run is in `profile/nightly-reindex.txt`.

        Make `search.index.build`, `search.rank.search` and `search.dedupe.unique_tokens` fast enough for
        these budgets on a normal laptop: build an index of 20,000 documents (10-50 words each) in under 4 s,
        run 100 queries on it in under 2 s, and `unique_tokens` on 200,000 tokens in under 0.5 s.

        Results must not change at all: the same index structure, the same scores (bit for bit) and the
        same order of results. Keep the public API unchanged and the existing tests passing.
        ''')
    t.hidden(f'''
        import random, time, unittest
        from search.index import build
        from search.rank import search
        from search.dedupe import unique_tokens

        EXPECTED = {expected!r}


        # CORPUS


        class Hidden(unittest.TestCase):
            def test_results_identical(self):
                idx = build(_corpus(5, 400))
                for q, exp in EXPECTED.items():
                    self.assertEqual([tuple(x) for x in search(idx, q)], [tuple(x) for x in exp], q)

            def test_structure(self):
                idx = build([("b", "x y x"), ("a", "x")])
                self.assertEqual(idx["postings"]["x"], [("a", 1), ("b", 2)])
                self.assertEqual(idx["postings"]["y"], [("b", 1)])

            def test_unique_fast(self):
                r = random.Random(1)
                toks = [f"t{{r.randrange(50000)}}" for _ in range(200000)]
                t0 = time.perf_counter()
                u = unique_tokens(toks)
                self.assertLess(time.perf_counter() - t0, 0.5)
                self.assertEqual(len(u), len(set(toks)))
                self.assertEqual(u[:3], list(dict.fromkeys(toks))[:3])

            def test_build_and_query_fast(self):
                docs = _corpus(9, 20000)
                t0 = time.perf_counter()
                idx = build(docs)
                self.assertLess(time.perf_counter() - t0, 4.0)
                t0 = time.perf_counter()
                for i in range(100):
                    search(idx, f"w{{i}} w{{i * 7}} alpha kernel")
                self.assertLess(time.perf_counter() - t0, 2.0)
        ''')
    hp = os.path.join(t.root, "hidden_test.py")
    import inspect
    src = open(hp).read().replace("# CORPUS", inspect.getsource(_corpus).strip())
    open(hp, "w").write(src)



# ---------------------------------------------------------------------------------------------
REPORT_CORE = '''
REGIONS = ["North", "South", "East", "West", "Central", "Islands"]


def format_amount(x):
    """Money column."""
    return f"{x:.2f}"


def format_name(name, width=20):
    """Name column, `width` characters."""
    return name.ljust(width)


def render(rows):
    """rows: list of {"region", "rep", "amount" (Decimal)}. Returns the report text."""
    out = ["SALES BY REGION", "=" * 37]
    by = {r: [] for r in REGIONS}
    for row in rows:
        by.setdefault(row["region"], []).append(row)
    grand = Decimal("0")
    for region, items in by.items():
        if not items:
            continue
        out.append(f"[{region}]")
        total = Decimal("0")
        for it in sorted(items, key=lambda r: (r["rep"], r["amount"])):
            out.append(f"  {format_name(it['rep'])} {format_amount(it['amount']).rjust(14)}")
            total += it["amount"]
        out.append(f"  {'TOTAL'.ljust(20)} {format_amount(total).rjust(14)}")
        grand += total
    out.append("=" * 37)
    out.append(f"  {'GRAND TOTAL'.ljust(20)} {format_amount(grand).rjust(14)}")
    return "\\n".join(out) + "\\n"
'''
REPORT_FIXED = REPORT_CORE.replace('''    return f"{x:.2f}"''', '''    s = f"{abs(x):,.2f}"
    return f"({s})" if x < 0 else s''').replace('''    return name.ljust(width)''', '''    if len(name) > width:
        name = name[: width - 1] + "\\u2026"
    return name.ljust(width)''').replace('''        if not items:
            continue
        out.append(f"[{region}]")''', '''        out.append(f"[{region}]")
        if not items:
            out.append("  (no sales)")''')
REPORT_TAIL = '''

def load(path):
    with open(path, newline="", encoding="utf-8") as f:
        return [{"region": r["region"], "rep": r["rep"], "amount": Decimal(r["amount"])} for r in csv.DictReader(f)]


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    sys.stdout.write(render(load(argv[0])))


if __name__ == "__main__":
    main()
'''


def _sales(seed, n, skip_region="Islands"):
    r = random.Random(seed)
    first = ["Mari", "Jaan", "Liis", "Peeter", "Kadri", "Toomas", "Anneli", "Hendrik", "Kristiina", "Aleksander"]
    last = ["Tamm", "Saar", "Sepp", "Kask", "Mägi", "Rebane", "Ilves", "Kuusk", "Lepik-Vaarmann", "Põldsaar-Kõrvits"]
    regions = [x for x in ["North", "South", "East", "West", "Central", "Islands"] if x != skip_region]
    rows = ["region,rep,amount"]
    for _ in range(n):
        amt = r.choice([r.randint(1, 999), r.randint(1000, 99999), r.randint(100000, 9999999)]) / 100
        if r.random() < 0.12:
            amt = -amt
        rows.append(f"{r.choice(regions)},{r.choice(first)} {r.choice(last)},{amt:.2f}")
    return "\n".join(rows) + "\n"


@task
def legacy_report():
    """A 1.4k-line legacy report script must match a golden file (a 2.5k-line diff shows four format rules)."""
    import difflib
    from decimal import Decimal
    t, rng = Task("legacy-report"), random.Random(66)
    head = '"""Regional sales report (legacy; owned by finance-tools). Usage: python3 report.py SALES.csv"""\nimport csv\nimport sys\nfrom decimal import Decimal\n'
    fill = [filler_fn(rng, "rpt", i) for i in range(90)]
    broken = head + "\n".join(fill[:50]) + "\n" + REPORT_CORE + "\n".join(fill[50:]) + REPORT_TAIL
    fixed = broken.replace(REPORT_CORE, REPORT_FIXED)
    t.repo("report.py", broken)
    t.ref("report.py", fixed)
    sales, sales2 = _sales(1, 1400), _sales(2, 120, skip_region="East")

    def run(src, csv_text):
        ns = {"__name__": "rpt"}
        exec(compile(src, "report.py", "exec"), ns)
        rows = [{"region": a, "rep": b, "amount": Decimal(c)} for a, b, c in (l.split(",") for l in csv_text.splitlines()[1:])]
        return ns["render"](rows)
    exp, cur, exp2 = run(fixed, sales), run(broken, sales), run(fixed, sales2)
    t.repo("data/sales.csv", sales)
    t.repo("golden/expected.txt", exp)
    t.repo("golden/current.txt", cur)
    t.repo("golden/current-vs-expected.diff", "".join(difflib.unified_diff(cur.splitlines(True), exp.splitlines(True), "current.txt", "expected.txt", n=1)))
    t.repo("tests/__init__.py", "")
    t.repo("tests/test_report.py", D('''
        import unittest
        from decimal import Decimal
        import report


        class T(unittest.TestCase):
            def test_header(self):
                out = report.render([{"region": "North", "rep": "A B", "amount": Decimal("1.50")}])
                self.assertTrue(out.startswith("SALES BY REGION\\n"))
                self.assertIn("[North]", out)
        '''))
    t.repo("README.md", "# finance report\n\n`python3 report.py data/sales.csv > out.txt`. The agreed output for that file is `golden/expected.txt`.\n")
    t.issue('''
        Finance says our regional sales report (`report.py`) no longer matches the agreed format.
        `golden/expected.txt` is the agreed output for `data/sales.csv`; `golden/current.txt` is what
        `python3 report.py data/sales.csv` prints today, and `golden/current-vs-expected.diff` is the diff.

        Make the output match the golden file exactly. Work out the formatting rules behind every kind
        of difference and implement the rules, not special cases: the report runs on other sales files
        too, and they will be checked against the same rules. Keep `render(rows)`, `load(path)` and the
        command line unchanged.
        ''')
    t.hidden(f'''
        import os, subprocess, sys, unittest
        from decimal import Decimal
        import report

        HERE = os.path.dirname(os.path.abspath(__file__))
        SALES2 = {sales2!r}
        EXPECTED2 = {exp2!r}


        class Hidden(unittest.TestCase):
            def test_golden_cli(self):
                out = subprocess.run([sys.executable, "report.py", "data/sales.csv"], cwd=HERE, capture_output=True, text=True).stdout
                self.assertEqual(out, open(os.path.join(HERE, "golden", "expected.txt"), encoding="utf-8").read())

            def test_other_file(self):
                rows = [{{"region": a, "rep": b, "amount": Decimal(c)}} for a, b, c in (l.split(",") for l in SALES2.splitlines()[1:])]
                self.assertEqual(report.render(rows), EXPECTED2)

            def test_rules(self):
                self.assertEqual(report.format_amount(Decimal("-1234567.5")), "(1,234,567.50)")
                self.assertEqual(report.format_amount(Decimal("999.999")), "1,000.00")
                self.assertEqual(report.format_name("x" * 25), "x" * 19 + "\\u2026")
                self.assertEqual(report.format_name("Ann"), "Ann" + " " * 17)
                out = report.render([])
                self.assertEqual(out.count("(no sales)"), 6)
        ''')



# ---------------------------------------------------------------------------------------------
def _orders(seed, n_each):
    """Three input files: (name, bytes)."""
    r = random.Random(seed)
    custs = ["Müller GmbH", "Šimon s.r.o.", "Café Noël", "Tamm OÜ", "Acme Inc", "Øresund AB", "Åbo Oy", "Smith & Co"]
    files = []
    for name, src, off, enc, bom, dec in [("shop-eu.csv", "eu", "+03:00", "utf-8", True, 2), ("shop-us.csv", "us", "-05:00", "cp1252", False, 2),
                                          ("pos.csv", "pos", "Z", "utf-8", False, 3)]:
        lines = ["source,order_id,customer,ts,amount"]
        prev = []
        for i in range(n_each):
            if prev and r.random() < 0.08:
                lines.append(r.choice(prev))  # re-sent row
                continue
            oid = str(r.randint(1000, 1000 + n_each * 2))
            h = r.choice([0, 1, 2, 3, 4, 20, 21, 22, 23])
            ts = f"2026-10-{r.randint(1, 3):02d}T{h:02d}:{r.randint(0, 59):02d}:00{off}"
            amt = r.randint(100, 99999) / 100 if dec == 2 else f"{r.randint(10, 9999)}.{r.randint(0, 99):02d}5"
            amt = f"{amt:.2f}" if dec == 2 else amt
            line = f"{src},{oid},{r.choice(custs)},{ts},{amt}"
            if r.random() < 0.1:
                line = f" {src} , {oid} ,{r.choice(custs)} , {ts}, {amt} "
            lines.append(line)
            prev.append(line)
        text = "\r\n".join(lines) + "\r\n"
        files.append((name, (("﻿" if bom else "") + text).encode(enc)))
    return files


@task
def etl_pipeline():
    """A 4-stage ETL with a bug in every stage; mixed encodings, offsets and duplicate ids in the input."""
    import subprocess, tempfile
    t, rng = Task("etl-pipeline"), random.Random(77)
    stages = {
        "extract": ("import csv\nimport io\nimport os\n", D('''
            def read_rows(path):
                """Rows of one input file as dicts (docs/pipeline.md, "Extract")."""
                with open(path, encoding="utf-8", newline="") as f:
                    return list(csv.DictReader(f))


            def read_dir(d):
                rows = []
                for name in sorted(os.listdir(d)):
                    if name.endswith(".csv"):
                        rows.extend(read_rows(os.path.join(d, name)))
                return rows
            '''), D('''
            def read_rows(path):
                """Rows of one input file as dicts (docs/pipeline.md, "Extract")."""
                raw = open(path, "rb").read()
                try:
                    text = raw.decode("utf-8-sig")
                except UnicodeDecodeError:
                    text = raw.decode("cp1252")
                return list(csv.DictReader(io.StringIO(text, newline="")))


            def read_dir(d):
                rows = []
                for name in sorted(os.listdir(d)):
                    if name.endswith(".csv"):
                        rows.extend(read_rows(os.path.join(d, name)))
                return rows
            ''')),
        "transform": ("from datetime import datetime\nfrom decimal import Decimal, ROUND_HALF_UP\n", D('''
            def clean(row):
                """One raw row -> typed record (docs/pipeline.md, "Transform")."""
                return {"source": row["source"].strip(), "order_id": row["order_id"].strip(), "customer": row["customer"].strip(),
                        "ts": datetime.fromisoformat(row["ts"].strip()), "amount": Decimal(str(round(float(row["amount"]), 2)))}
            '''), D('''
            def clean(row):
                """One raw row -> typed record (docs/pipeline.md, "Transform")."""
                return {"source": row["source"].strip(), "order_id": row["order_id"].strip(), "customer": row["customer"].strip(),
                        "ts": datetime.fromisoformat(row["ts"].strip()),
                        "amount": Decimal(row["amount"].strip()).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)}
            ''')),
        "dedupe": ("", D('''
            def dedupe(rows):
                """Drop repeated orders, keeping the first (docs/pipeline.md, "Dedupe")."""
                seen, out = set(), []
                for r in rows:
                    key = r["order_id"]
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append(r)
                return out
            '''), D('''
            def dedupe(rows):
                """Drop repeated orders, keeping the first (docs/pipeline.md, "Dedupe")."""
                seen, out = set(), []
                for r in rows:
                    key = (r["source"], r["order_id"])
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append(r)
                return out
            ''')),
        "load": ("import csv\nfrom datetime import timezone\nfrom decimal import Decimal\n", D('''
            def summarise(rows):
                """{(day, customer): [orders, total]} (docs/pipeline.md, "Load")."""
                out = {}
                for r in rows:
                    day = r["ts"].date().isoformat()
                    cur = out.setdefault((day, r["customer"]), [0, Decimal("0")])
                    cur[0] += 1
                    cur[1] += r["amount"]
                return out


            def write(path, summary):
                with open(path, "w", newline="", encoding="utf-8") as f:
                    w = csv.writer(f, lineterminator="\\n")
                    w.writerow(["day", "customer", "orders", "total"])
                    for (day, cust), (n, total) in sorted(summary.items()):
                        w.writerow([day, cust, n, f"{total:.2f}"])
            '''), D('''
            def summarise(rows):
                """{(day, customer): [orders, total]} (docs/pipeline.md, "Load")."""
                out = {}
                for r in rows:
                    day = r["ts"].astimezone(timezone.utc).date().isoformat()
                    cur = out.setdefault((day, r["customer"]), [0, Decimal("0")])
                    cur[0] += 1
                    cur[1] += r["amount"]
                return out


            def write(path, summary):
                with open(path, "w", newline="", encoding="utf-8") as f:
                    w = csv.writer(f, lineterminator="\\n")
                    w.writerow(["day", "customer", "orders", "total"])
                    for (day, cust), (n, total) in sorted(summary.items()):
                        w.writerow([day, cust, n, f"{total:.2f}"])
            ''')),
    }
    for name, (imp, broken, fixed) in stages.items():
        src = filler_module(rng, name[:3], 15, f"etl.{name}: the {name} stage.", imp, broken)
        t.repo(f"etl/{name}.py", src)
        t.ref(f"etl/{name}.py", src.replace(broken.strip("\n"), fixed.strip("\n")))
    for name in ["schedule", "alerts", "metrics", "archive", "config"]:
        t.repo(f"etl/{name}.py", filler_module(rng, name[:3], 16, f"etl.{name}: support code (not part of the data path).", "", ""))
    t.repo("etl/__init__.py", '"""Nightly order summary pipeline."""\n')
    t.repo("etl/__main__.py", D('''
        """python3 -m etl INPUT_DIR OUTPUT.csv"""
        import sys
        from .extract import read_dir
        from .transform import clean
        from .dedupe import dedupe
        from .load import summarise, write


        def main(argv=None):
            argv = sys.argv[1:] if argv is None else argv
            rows = [clean(r) for r in read_dir(argv[0])]
            write(argv[1], summarise(dedupe(rows)))


        if __name__ == "__main__":
            main()
        '''))
    t.repo("docs/pipeline.md", D('''
        # Nightly order summary

        Input: every `*.csv` file of the input directory, one per order source (web shop EU, web shop US,
        point of sale). Output: one CSV with the number of orders and the order total per UTC day and
        customer. Finance reconciles it against the bank, so it must be exact.

        ## Extract

        - Files are CSV with a header `source,order_id,customer,ts,amount`, CRLF or LF line ends.
        - The EU shop exports UTF-8 with a byte-order mark. The US shop's legacy exporter writes Windows-1252
          (cp1252). Others write plain UTF-8. Read each file as UTF-8 (a BOM is not part of the first column
          name); if a file is not valid UTF-8, read it as cp1252.
        - Files are read in name order; rows keep their order within a file.

        ## Transform

        - Surrounding whitespace is stripped from every field.
        - `ts` is ISO 8601 with an offset or `Z`.
        - `amount` is a decimal string, sometimes with three decimals (the POS system). Round to cents
          half-up (2.345 -> 2.35, 2.344 -> 2.34). Never go through binary floating point.

        ## Dedupe

        - Sources re-send orders, so an order can appear several times; keep its first occurrence.
        - Order ids are only unique within a source: `eu` order 1234 and `us` order 1234 are different
          orders. An order is identified by (source, order_id).

        ## Load

        - Group by the UTC calendar day of `ts` (a `-05:00` order at 21:00 on Oct 1 belongs to Oct 2) and
          by customer (exact string after stripping).
        - Columns `day,customer,orders,total`; total with two decimals; rows sorted by day, then customer.
          UTF-8, LF line ends.

        ## Operations

        The job runs at 02:00 UTC from cron (`etl/schedule.py`), alerts go to the data channel
        (`etl/alerts.py`), and inputs are archived for 90 days (`etl/archive.py`). None of this touches
        the data path.
        '''))
    for name, data in _orders(7, 900):
        p = os.path.join(t.root, "repo", "data", "input", name)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "wb").write(data)

    def oracle(files):
        with tempfile.TemporaryDirectory(dir=os.path.expanduser("~/.cache/pi-extras/d3-context/tmp")) as w:
            shutil.copytree(os.path.join(t.root, "repo"), w, dirs_exist_ok=True)
            shutil.copytree(os.path.join(t.root, "ref"), w, dirs_exist_ok=True)
            inp = os.path.join(w, "in2")
            os.makedirs(inp)
            for name, data in files:
                open(os.path.join(inp, name), "wb").write(data)
            subprocess.run([sys.executable, "-m", "etl", inp, "out.csv"], cwd=w, check=True)
            return open(os.path.join(w, "out.csv"), encoding="utf-8").read()
    os.makedirs(os.path.expanduser("~/.cache/pi-extras/d3-context/tmp"), exist_ok=True)
    t.repo("expected/summary.csv", oracle(_orders(7, 900)))
    files2 = _orders(8, 150)
    exp2 = oracle(files2)
    t.repo("tests/__init__.py", "")
    t.repo("tests/test_stages.py", D('''
        import unittest
        from datetime import datetime, timezone
        from decimal import Decimal
        from etl.transform import clean
        from etl.dedupe import dedupe


        class T(unittest.TestCase):
            def test_clean(self):
                r = clean({"source": " eu ", "order_id": "1", "customer": "A", "ts": "2026-10-01T10:00:00Z", "amount": "1.50"})
                self.assertEqual(r["amount"], Decimal("1.50"))
                self.assertEqual(r["ts"], datetime(2026, 10, 1, 10, tzinfo=timezone.utc))

            def test_dedupe_same_source(self):
                a = {"source": "eu", "order_id": "1"}
                self.assertEqual(dedupe([a, dict(a)]), [a])
        '''))
    t.repo("README.md", "# etl\n\n`python3 -m etl data/input out.csv`. Spec: `docs/pipeline.md`. Last night's correct output (checked by hand by finance): `expected/summary.csv`.\n")
    t.issue('''
        The nightly order summary is broken: on last night's files (`data/input/`) `python3 -m etl
        data/input out.csv` crashes, and finance says that even before it started crashing the numbers
        were off. `docs/pipeline.md` is the spec; `expected/summary.csv` is the output finance checked by
        hand for these input files.

        Fix the pipeline in `etl/` so that it follows the spec and reproduces `expected/summary.csv`
        exactly. It must also be right for other nights' files (other customers, ids and amounts).
        Keep the module structure and the command line as they are; keep the existing tests passing.
        ''')
    t.hidden(f'''
        import os, subprocess, sys, tempfile, unittest
        from decimal import Decimal

        HERE = os.path.dirname(os.path.abspath(__file__))
        FILES2 = {[(n, d) for n, d in files2]!r}
        EXPECTED2 = {exp2!r}


        class Hidden(unittest.TestCase):
            def run_etl(self, inp, out):
                return subprocess.run([sys.executable, "-m", "etl", inp, out], cwd=HERE, capture_output=True, text=True, timeout=120)

            def test_last_night(self):
                with tempfile.TemporaryDirectory() as d:
                    p = self.run_etl(os.path.join(HERE, "data", "input"), os.path.join(d, "o.csv"))
                    self.assertEqual(p.returncode, 0, p.stderr[-2000:])
                    self.assertEqual(open(os.path.join(d, "o.csv"), encoding="utf-8").read(),
                                     open(os.path.join(HERE, "expected", "summary.csv"), encoding="utf-8").read())

            def test_other_night(self):
                with tempfile.TemporaryDirectory() as d:
                    os.makedirs(os.path.join(d, "in"))
                    for name, data in FILES2:
                        open(os.path.join(d, "in", name), "wb").write(data)
                    p = self.run_etl(os.path.join(d, "in"), os.path.join(d, "o.csv"))
                    self.assertEqual(p.returncode, 0, p.stderr[-2000:])
                    self.assertEqual(open(os.path.join(d, "o.csv"), encoding="utf-8").read(), EXPECTED2)

            def test_rounding(self):
                from etl.transform import clean
                for a, e in [("2.345", "2.35"), ("2.344", "2.34"), ("0.005", "0.01"), ("1.015", "1.02")]:
                    r = clean({{"source": "pos", "order_id": "1", "customer": "A", "ts": "2026-10-01T10:00:00Z", "amount": a}})
                    self.assertEqual(r["amount"], Decimal(e), a)
        ''')



# ---------------------------------------------------------------------------------------------
CFG_PARTIAL = '''
NAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,30}$")


def _check_service(svc, errors):
    if "name" not in svc:
        errors.append("service.name: required")
    elif not isinstance(svc["name"], str) or not NAME_RE.match(svc["name"]):
        errors.append("service.name: must match ^[a-z][a-z0-9-]{1,30}$")
    port = svc.get("port")
    if not isinstance(port, int) or not 1 <= port <= 65535:
        errors.append("service.port: must be an integer between 1 and 65535")


def _check_routes(routes, upstreams, errors):
    for i, r in enumerate(routes):
        p = f"routes[{i}]"
        if not str(r.get("path", "")).startswith("/"):
            errors.append(f"{p}.path: must start with /")
        if r.get("upstream") not in upstreams:
            errors.append(f"{p}.upstream: unknown upstream {r.get('upstream')!r}")


def validate(cfg):
    """All problems of a gateway config, as sorted "<path>: <message>" strings (docs/config-spec.md)."""
    errors = []
    _check_service(cfg.get("service", {}), errors)
    _check_routes(cfg.get("routes", []), cfg.get("upstreams", {}), errors)
    return sorted(errors)
'''
CFG_FULL = '''
NAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,30}$")
HOST_RE = re.compile(r"^[A-Za-z0-9.-]+:[0-9]{1,5}$")
METHODS = {"GET", "POST", "PUT", "DELETE", "PATCH"}
TOP = {"service", "routes", "upstreams", "limits"}


def _int_in(v, lo, hi):
    return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi


def _check_service(svc, errors):
    if "name" not in svc:
        errors.append("service.name: required")
    elif not isinstance(svc["name"], str) or not NAME_RE.match(svc["name"]):
        errors.append("service.name: must match ^[a-z][a-z0-9-]{1,30}$")
    if not _int_in(svc.get("port"), 1, 65535):
        errors.append("service.port: must be an integer between 1 and 65535")
    if "replicas" in svc and not _int_in(svc["replicas"], 1, 10**9):
        errors.append("service.replicas: must be a positive integer")


def _check_routes(routes, upstreams, errors):
    first = {}
    for i, r in enumerate(routes):
        p = f"routes[{i}]"
        path = r.get("path", "")
        if not str(path).startswith("/"):
            errors.append(f"{p}.path: must start with /")
        elif path in first:
            errors.append(f"{p}.path: duplicate of routes[{first[path]}].path")
        else:
            first[path] = i
        if r.get("upstream") not in upstreams:
            errors.append(f"{p}.upstream: unknown upstream {r.get('upstream')!r}")
        if "timeout_ms" in r and not _int_in(r["timeout_ms"], 1, 60000):
            errors.append(f"{p}.timeout_ms: must be an integer between 1 and 60000")
        for j, m in enumerate(r.get("methods", [])):
            if m not in METHODS:
                errors.append(f"{p}.methods[{j}]: unknown method {m!r}")


def _check_upstreams(upstreams, errors):
    for name, u in upstreams.items():
        hosts = u.get("hosts", [])
        if not hosts:
            errors.append(f"upstreams.{name}.hosts: must not be empty")
        for j, h in enumerate(hosts):
            if not isinstance(h, str) or not HOST_RE.match(h) or not 1 <= int(h.rsplit(":", 1)[1]) <= 65535:
                errors.append(f"upstreams.{name}.hosts[{j}]: must be host:port")


def _check_limits(limits, errors):
    for k in ("rps", "burst"):
        if k in limits and not _int_in(limits[k], 1, 10**9):
            errors.append(f"limits.{k}: must be a positive integer")
    if _int_in(limits.get("rps"), 1, 10**9) and _int_in(limits.get("burst"), 1, 10**9) and limits["burst"] < limits["rps"]:
        errors.append("limits.burst: must be >= limits.rps")


def validate(cfg):
    """All problems of a gateway config, as sorted "<path>: <message>" strings (docs/config-spec.md)."""
    errors = []
    for k in cfg:
        if k not in TOP:
            errors.append(f"{k}: unknown key")
    _check_service(cfg.get("service", {}), errors)
    _check_routes(cfg.get("routes", []), cfg.get("upstreams", {}), errors)
    _check_upstreams(cfg.get("upstreams", {}), errors)
    _check_limits(cfg.get("limits", {}), errors)
    return sorted(errors)
'''


def _configs(seed, n):
    r = random.Random(seed)
    out = []
    for i in range(n):
        ups = {u: {"hosts": [f"{u}{k}.internal:{r.choice([80, 443, 8080])}" for k in range(r.randint(1, 3))], "tls": r.random() < .5}
               for u in r.sample(["api", "auth", "static", "search", "billing"], r.randint(1, 3))}
        routes = [{"path": f"/{r.choice(['v1', 'v2', 'admin', 'files', 'login'])}/{r.choice(['a', 'b', 'c'])}", "upstream": r.choice(list(ups)),
                   **({"timeout_ms": r.choice([500, 2000, 30000])} if r.random() < .6 else {}),
                   **({"methods": r.sample(["GET", "POST", "PUT", "DELETE", "PATCH"], r.randint(1, 3))} if r.random() < .5 else {})}
                  for _ in range(r.randint(1, 5))]
        cfg = {"service": {"name": f"svc-{i}", "port": r.choice([80, 8080, 9000])}, "routes": routes, "upstreams": ups}
        if r.random() < .5:
            cfg["service"]["replicas"] = r.randint(1, 6)
        if r.random() < .5:
            rps = r.randint(10, 500)
            cfg["limits"] = {"rps": rps, "burst": rps * r.randint(1, 3)}
        for _ in range(r.randint(0, 4)):  # break it
            k = r.randrange(14)
            if k == 0: cfg["service"]["name"] = r.choice(["Svc", "9svc", "s", "svc_under"])
            elif k == 1: cfg["service"]["port"] = r.choice([0, 70000, "80", True, 8.5])
            elif k == 2: cfg["service"]["replicas"] = r.choice([0, -1, "3", True])
            elif k == 3: r.choice(routes)["path"] = r.choice(["v1/x", "", "admin"])
            elif k == 4: routes.append(dict(r.choice(routes)))
            elif k == 5: r.choice(routes)["upstream"] = r.choice(["legacy", "API", None])
            elif k == 6: r.choice(routes)["timeout_ms"] = r.choice([0, 60001, "100", 2.5, False])
            elif k == 7: r.choice(routes)["methods"] = ["GET", r.choice(["get", "FETCH", "OPTIONS"])]
            elif k == 8: next(iter(ups.values()))["hosts"] = []
            elif k == 9: next(iter(ups.values()))["hosts"] = ["good:80", r.choice(["nohost", "x:99999", "a b:80", ":80"])]
            elif k == 10: cfg["limits"] = {"rps": 100, "burst": r.choice([10, 99])}
            elif k == 11: cfg["limits"] = {"rps": r.choice([0, -5, "1"]), "burst": 10}
            elif k == 12: cfg[r.choice(["logging", "Service", "route"])] = {}
            elif k == 13: del cfg["service"]["name"]
        out.append(cfg)
    return out


@task
def config_validator():
    """Complete a config validator from a long spec; 40 sample configs with the expected messages."""
    import json, re
    t, rng = Task("config-validator"), random.Random(88)
    t.repo("cfgcheck/__init__.py", '"""Validator for gateway configs."""\nfrom .validate import validate  # noqa\n')
    head = "import re\n"
    broken = filler_module(rng, "val", 14, "cfgcheck.validate.", head, CFG_PARTIAL)
    t.repo("cfgcheck/validate.py", broken)
    t.ref("cfgcheck/validate.py", broken.replace(CFG_PARTIAL.strip("\n"), CFG_FULL.strip("\n")))
    for name in ["loader", "render", "diff", "lint", "schema_docs"]:
        t.repo(f"cfgcheck/{name}.py", filler_module(rng, name[:3], 14, f"cfgcheck.{name}.", "", ""))
    ns = {}
    exec("import re\n" + CFG_FULL, ns)
    samples = _configs(3, 40)
    exp_lines = []
    for i, c in enumerate(samples):
        name = f"gw-{i:02d}.json"
        t.repo(f"samples/{name}", json.dumps(c, indent=2) + "\n")
        errs = ns["validate"](c)
        exp_lines += [f"{name}: {e}" for e in errs] or [f"{name}: OK"]
    t.repo("samples/expected.txt", "\n".join(exp_lines) + "\n")
    extra = _configs(4, 60)
    extra_exp = [ns["validate"](c) for c in extra]
    words = ("gateway route upstream service replica deployment canary rollout timeout retry header cluster "
             "region failover health check certificate tls listener").split()
    spec = ["# Gateway config specification", "", "Version 3. A config is a JSON object. `cfgcheck.validate(cfg)` returns every problem as",
            "`<path>: <message>`, sorted (plain string sort). A valid config gives an empty list.", "",
            "Paths: object keys are joined with `.`, list items are written `[i]` (0-based), e.g. `routes[2].methods[0]`.", "",
            "\"Integer\" means a JSON integer: `true`/`false` and floats such as `8.5` are not integers, nor are strings.", ""]
    rules = [
        ("Top level", "The only top-level keys are `service`, `routes`, `upstreams` and `limits`. Any other key `k` gives `k: unknown key`. Keys are case-sensitive."),
        ("service.name", "Required: `service.name: required` when missing. It must match `^[a-z][a-z0-9-]{1,30}$`, otherwise `service.name: must match ^[a-z][a-z0-9-]{1,30}$`."),
        ("service.port", "Required integer between 1 and 65535, otherwise `service.port: must be an integer between 1 and 65535`."),
        ("service.replicas", "Optional (default 1). When present it must be a positive integer: `service.replicas: must be a positive integer`."),
        ("routes[i].path", "Must start with `/`: `routes[i].path: must start with /`. Paths must be unique: the second and every later route with a path already used gives `routes[j].path: duplicate of routes[i].path`, where `i` is the first route with that path. A path that does not start with `/` is only reported as such (not also as a duplicate) and does not count as a first occurrence."),
        ("routes[i].upstream", "Must be the name of an entry of `upstreams`: `routes[i].upstream: unknown upstream 'name'` (the value written as Python's `repr`, so `None` for null)."),
        ("routes[i].timeout_ms", "Optional. Integer between 1 and 60000: `routes[i].timeout_ms: must be an integer between 1 and 60000`."),
        ("routes[i].methods", "Optional list. Each entry must be one of GET, POST, PUT, DELETE, PATCH (upper case): `routes[i].methods[j]: unknown method 'get'` (repr of the value)."),
        ("upstreams.NAME.hosts", "Must be a non-empty list: `upstreams.NAME.hosts: must not be empty` (also when the key is missing). Each entry is `host:port`, host made of letters, digits, `.` and `-`, port 1-65535: `upstreams.NAME.hosts[j]: must be host:port`."),
        ("limits", "Optional. `rps` and `burst` must be positive integers when present: `limits.rps: must be a positive integer` (same for burst). When both are valid, burst must be at least rps: `limits.burst: must be >= limits.rps`."),
    ]
    for i in range(36):
        spec.append(f"## Background {i + 1}: {rng.choice(words)} {rng.choice(words)}")
        spec.append("")
        spec += textwrap.wrap(" ".join(" ".join(rng.choice(words) for _ in range(rng.randint(10, 20))).capitalize() + "." for _ in range(rng.randint(3, 6))), 96)
        spec.append("")
        if i % 3 == 2 and rules:
            title, text = rules.pop(0)
            spec += [f"## Rule: {title}", ""] + textwrap.wrap(text, 96) + [""]
    assert not rules
    t.repo("docs/config-spec.md", "\n".join(spec))
    t.repo("tests/__init__.py", "")
    t.repo("tests/test_validate.py", D('''
        import unittest
        from cfgcheck import validate

        GOOD = {"service": {"name": "web", "port": 80}, "routes": [{"path": "/", "upstream": "api"}],
                "upstreams": {"api": {"hosts": ["api.internal:80"]}}}


        class T(unittest.TestCase):
            def test_good(self):
                self.assertEqual(validate(GOOD), [])

            def test_port(self):
                bad = {**GOOD, "service": {"name": "web", "port": 0}}
                self.assertEqual(validate(bad), ["service.port: must be an integer between 1 and 65535"])
        '''))
    t.repo("README.md", "# cfgcheck\n\nValidates gateway configs. Spec: `docs/config-spec.md`. `samples/` holds real configs and `samples/expected.txt` the agreed messages.\n")
    t.issue('''
        `cfgcheck.validate` only implements part of `docs/config-spec.md`. Implement the whole spec
        (every rule, with exactly the messages it gives). `samples/*.json` are real configs from our
        clusters and `samples/expected.txt` lists the messages the spec gives for each of them (`OK` when
        there are none): your validator must reproduce that file line for line, and it will also be run
        on other configs. Keep `validate(cfg)` as the entry point; keep the existing tests passing.
        ''')
    t.hidden(f'''
        import json, os, unittest
        from cfgcheck import validate

        HERE = os.path.dirname(os.path.abspath(__file__))
        EXTRA = {extra!r}
        EXTRA_EXP = {extra_exp!r}


        class Hidden(unittest.TestCase):
            def test_samples(self):
                got = []
                for name in sorted(os.listdir(os.path.join(HERE, "samples"))):
                    if name.endswith(".json"):
                        errs = validate(json.load(open(os.path.join(HERE, "samples", name))))
                        got += [f"{{name}}: {{e}}" for e in errs] or [f"{{name}}: OK"]
                self.assertEqual(got, open(os.path.join(HERE, "samples", "expected.txt")).read().splitlines())

            def test_other_configs(self):
                for c, e in zip(EXTRA, EXTRA_EXP):
                    self.assertEqual(validate(c), e, json.dumps(c))
        ''')
    # the extra configs are written with Python literals (True/None) by repr: fine for exec in the test



# ---------------------------------------------------------------------------------------------
KV_CORE = '''
def load(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)


def env_line(key, value):
    return f"{key}={value}"


def main(argv=None, out=sys.stdout, err=sys.stderr):
    p = argparse.ArgumentParser(prog="kv")
    p.add_argument("--store", default=os.environ.get("KV_STORE", "kv.json"))
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("set"); s.add_argument("pairs", nargs="+", help="KEY=VALUE")
    g = sub.add_parser("get"); g.add_argument("key")
    d = sub.add_parser("del"); d.add_argument("keys", nargs="+")
    ls = sub.add_parser("list"); ls.add_argument("--prefix", default="")
    ex = sub.add_parser("export"); ex.add_argument("--format", choices=["json", "env"], default="json")
    a = p.parse_args(argv)
    data = load(a.store)
    if a.cmd == "set":
        for pair in a.pairs:
            parts = pair.split("=")
            if len(parts) < 2 or not parts[0]:
                print(f"kv: bad pair: {pair}", file=err)
                return 2
            data[parts[0]] = parts[1]
        save(a.store, data)
    elif a.cmd == "get":
        print(data.get(a.key), file=out)
    elif a.cmd == "del":
        data.pop(a.keys[0], None)
        save(a.store, data)
    elif a.cmd == "list":
        for k in data:
            if k.startswith(a.prefix):
                print(k, file=out)
    elif a.cmd == "export":
        if a.format == "json":
            print(json.dumps(data, ensure_ascii=False, sort_keys=True), file=out)
        else:
            for k in sorted(data):
                print(env_line(k, data[k]), file=out)
    return 0
'''
KV_FIXED = (KV_CORE
            .replace('''            parts = pair.split("=")''', '''            parts = pair.split("=", 1)''')
            .replace('''        print(data.get(a.key), file=out)''', '''        if a.key not in data:
            print(f"kv: no such key: {a.key}", file=err)
            return 1
        print(data[a.key], file=out)''')
            .replace('''        data.pop(a.keys[0], None)''', '''        for k in a.keys:
            data.pop(k, None)''')
            .replace('''        for k in data:
            if k.startswith(a.prefix):''', '''        for k in sorted(data):
            if k.startswith(a.prefix):''')
            .replace('''    return f"{key}={value}"''', '''    if value == "" or any(c in value for c in " \\t\\n'\\"$`\\\\;&|<>*?()#~"):
        value = "'" + value.replace("'", "'\\\\''") + "'"
    return f"{key}={value}"'''))


@task
def issue_triage():
    """A CLI plus an exported tracker of 60 issues: fix exactly the open, accepted bugs."""
    import json
    t, rng = Task("issue-triage"), random.Random(99)
    head = "import argparse\nimport json\nimport os\nimport sys\n"
    broken = filler_module(rng, "kv", 22, "kv: a tiny key-value store on a JSON file. Usage: python3 -m kv --help", head, KV_CORE)
    t.repo("kv/__init__.py", "")
    t.repo("kv/__main__.py", "import sys\nfrom kv.cli import main\n\nsys.exit(main())\n")
    t.repo("kv/cli.py", broken)
    t.ref("kv/cli.py", broken.replace(KV_CORE.strip("\n"), KV_FIXED.strip("\n")))
    for name in ["completion", "migrate", "paths", "colors"]:
        t.repo(f"kv/{name}.py", filler_module(rng, name[:3], 14, f"kv.{name}.", "", ""))
    people = ["mtamm", "jsaar", "lsepp", "kkask", "pilves", "arebane", "hkuusk", "triage-bot"]
    real = [
        dict(title="`kv get` on a missing key prints None and exits 0", labels=["bug", "accepted"], state="open",
             body="`kv get nope` prints `None` and exits with status 0, so scripts cannot tell a missing key from the string 'None'.",
             comments=[("lsepp", "Agreed. Expected: nothing on stdout, `kv: no such key: nope` on stderr, exit status 1."), ("triage-bot", "Labelled accepted.")]),
        dict(title="Values containing '=' are cut off", labels=["bug", "accepted"], state="open",
             body="`kv set url=https://x.test/?a=1` stores `https://x.test/?a` ... everything after the second `=` is lost.",
             comments=[("kkask", "Only the first `=` separates key and value; the rest belongs to the value."), ("triage-bot", "Labelled accepted.")]),
        dict(title="`kv del a b c` only deletes a", labels=["bug", "accepted"], state="open",
             body="The usage says `del KEYS...` but only the first key is removed.", comments=[("jsaar", "Confirmed on main. Missing keys should be ignored like today.")]),
        dict(title="`kv list` order is random-looking", labels=["bug", "accepted"], state="open",
             body="list prints keys in insertion order, which differs between machines after a migrate.",
             comments=[("lsepp", "Make it sorted by key (plain string order), like export. The prefix filter stays case-sensitive (see #31).")]),
        dict(title="`kv export --format env` output breaks `source`", labels=["bug", "accepted"], state="open",
             body="A value with a space (`greeting=hello world`) is printed unquoted, so `. <(kv export --format env)` fails.",
             comments=[("pilves", "Quote with single quotes when the value is empty or contains whitespace or any shell-special character "
                        "(' \" $ ` \\ ; & | < > * ? ( ) # ~); a ' inside becomes '\\''. Plain values like `abc-1.2_x/y:z` stay unquoted."),
                       ("triage-bot", "Labelled accepted.")]),
    ]
    decoys = [
        dict(title="`kv list --prefix` should be case-insensitive", labels=["enhancement", "wontfix"], state="closed",
             body="I'd like `--prefix app` to also list `APP_NAME`.", comments=[("lsepp", "No: prefixes are case-sensitive by design (keys are case-sensitive). Closing.")]),
        dict(title="`kv get` should print a default with --default", labels=["enhancement", "needs-design"], state="open",
             body="Add `--default X`.", comments=[("jsaar", "Not now; needs a design for typed values.")]),
        dict(title="Unicode keys are escaped in kv.json", labels=["bug", "accepted"], state="closed",
             body="`kv set nimi=Jüri` writes \\u00fc.", comments=[("kkask", "Fixed in #12 (ensure_ascii=False). Closing.")]),
        dict(title="`kv set` should reject empty values", labels=["bug", "needs-info"], state="open",
             body="`kv set a=` stores an empty string. Is that intended?", comments=[("lsepp", "Empty values are valid. Leaving open until the reporter answers.")]),
        dict(title="`kv del` should fail on missing keys", labels=["bug", "wontfix"], state="open",
             body="Deleting a missing key silently succeeds.", comments=[("jsaar", "Intended: del is idempotent. wontfix.")]),
    ]
    words = ("store json migrate completion color terminal path windows macos export import backup sync "
             "lock concurrent write speed large file shell zsh fish bash").split()
    issues = []
    noise_n = 50
    for i in range(noise_n):
        issues.append(dict(title=" ".join(rng.choice(words) for _ in range(rng.randint(3, 8))).capitalize(),
                           labels=rng.choice([["question"], ["enhancement"], ["enhancement", "needs-design"], ["docs"], ["bug", "needs-info"],
                                              ["bug", "duplicate"], ["wontfix"], ["chore"]]),
                           state=rng.choice(["open", "open", "closed"]),
                           body="\n".join(" ".join(rng.choice(words) for _ in range(rng.randint(8, 20))).capitalize() + "." for _ in range(rng.randint(2, 6))),
                           comments=[(rng.choice(people), " ".join(rng.choice(words) for _ in range(rng.randint(6, 25))).capitalize() + ".")
                                     for _ in range(rng.randint(0, 4))]))
    allx = issues + real + decoys
    rng.shuffle(allx)
    export = []
    for n, it in enumerate(allx, start=2):
        export.append({"number": n, "title": it["title"], "state": it["state"], "labels": it["labels"], "author": rng.choice(people),
                       "created_at": f"2026-{rng.randint(1, 10):02d}-{rng.randint(1, 28):02d}T{rng.randint(0, 23):02d}:00:00Z",
                       "body": it["body"], "comments": [{"author": a, "body": b} for a, b in it["comments"]]})
    t.repo("issues/export.json", json.dumps(export, indent=2, ensure_ascii=False) + "\n")
    t.repo("tests/__init__.py", "")
    t.repo("tests/test_cli.py", D('''
        import io, os, tempfile, unittest
        from kv.cli import main


        class T(unittest.TestCase):
            def run_kv(self, *args):
                out, err = io.StringIO(), io.StringIO()
                rc = main(["--store", self.store, *args], out=out, err=err)
                return rc, out.getvalue(), err.getvalue()

            def setUp(self):
                self.d = tempfile.TemporaryDirectory()
                self.store = os.path.join(self.d.name, "kv.json")

            def tearDown(self):
                self.d.cleanup()

            def test_set_get(self):
                self.assertEqual(self.run_kv("set", "a=1")[0], 0)
                self.assertEqual(self.run_kv("get", "a"), (0, "1\\n", ""))
        '''))
    t.repo("README.md", "# kv\n\nA tiny key-value store: `python3 -m kv set a=1`, `get`, `del`, `list`, `export`.\nOur tracker export (all issues): `issues/export.json`.\n")
    t.issue('''
        Bug-fix release for `kv`. `issues/export.json` is an export of our whole issue tracker (open and
        closed issues, with their comments). Fix every bug that is **open** and labelled **accepted** —
        and nothing else: closed, `wontfix`, `needs-info` and unlabelled issues must not change behaviour.
        The comments on an issue define the expected behaviour where they say more than the title.
        Add a test for each fix to `tests/test_cli.py`.
        ''')
    t.hidden('''
        import io, json, os, subprocess, tempfile, unittest
        from kv.cli import main


        class Hidden(unittest.TestCase):
            def setUp(self):
                self.d = tempfile.TemporaryDirectory()
                self.store = os.path.join(self.d.name, "kv.json")

            def tearDown(self):
                self.d.cleanup()

            def kv(self, *args):
                out, err = io.StringIO(), io.StringIO()
                rc = main(["--store", self.store, *args], out=out, err=err)
                return rc, out.getvalue(), err.getvalue()

            def test_get_missing(self):
                self.assertEqual(self.kv("get", "nope"), (1, "", "kv: no such key: nope\\n"))

            def test_equals_in_value(self):
                self.kv("set", "url=https://x.test/?a=1&b=2", "e=")
                self.assertEqual(self.kv("get", "url")[1], "https://x.test/?a=1&b=2\\n")
                self.assertEqual(self.kv("get", "e"), (0, "\\n", ""))

            def test_del_many(self):
                self.kv("set", "a=1", "b=2", "c=3", "d=4")
                self.assertEqual(self.kv("del", "a", "c", "zz")[0], 0)
                self.assertEqual(sorted(json.load(open(self.store))), ["b", "d"])

            def test_list_sorted_case_sensitive(self):
                self.kv("set", "b=1", "APP=1", "app_x=1", "a=1", "app=1")
                self.assertEqual(self.kv("list")[1].split(), ["APP", "a", "app", "app_x", "b"])
                self.assertEqual(self.kv("list", "--prefix", "app")[1].split(), ["app", "app_x"])

            def test_env_quoting(self):
                self.kv("set", "a=hello world", "b=abc-1.2_x/y:z", "c=it's", "d=", "e=$HOME", "f=x;y")
                out = self.kv("export", "--format", "env")[1].splitlines()
                self.assertEqual(out, ["a='hello world'", "b=abc-1.2_x/y:z", "c='it'\\\\''s'", "d=''", "e='$HOME'", "f='x;y'"])
                script = "\\n".join(out) + '\\nprintf "%s|%s|%s|%s|%s|%s" "$a" "$b" "$c" "$d" "$e" "$f"'
                r = subprocess.run(["sh", "-c", script], capture_output=True, text=True)
                self.assertEqual(r.stdout, "hello world|abc-1.2_x/y:z|it's||$HOME|x;y")

            def test_unchanged(self):
                self.kv("set", "x=1")
                self.assertEqual(self.kv("del", "missing")[0], 0)
                self.assertEqual(self.kv("set", "a=")[0], 0)
                self.assertEqual(self.kv("set", "=v")[0], 2)
                self.kv("set", "nimi=Jüri")
                self.assertIn("Jüri", open(self.store, encoding="utf-8").read())
        ''')



# ---------------------------------------------------------------------------------------------
def _bundle(name, parts, intro):
    """One repo holding several tickets' repos side by side: one long session, many subtasks."""
    import re
    for p in parts:
        if not os.path.exists(os.path.join(OUT, p, "issue.md")):
            TASKS[p]()
    t = Task(name)
    readme, issue, hidden = [], [intro.strip(), ""], []
    for k, p in enumerate(parts, 1):
        src = os.path.join(OUT, p)
        for sub in ("repo", "ref"):
            for dirpath, _, files in os.walk(os.path.join(src, sub)):
                for f in files:
                    rel = os.path.relpath(os.path.join(dirpath, f), os.path.join(src, sub))
                    if rel == "README.md":
                        if sub == "repo":
                            readme.append(open(os.path.join(dirpath, f), encoding="utf-8").read().replace("# ", "## ", 1))
                        continue
                    dst = os.path.join(t.root, sub, rel)
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    assert not os.path.exists(dst) or rel == "tests/__init__.py", (name, rel)
                    shutil.copyfile(os.path.join(dirpath, f), dst)
        issue += [f"## Blocker {k}", "", open(os.path.join(src, "issue.md"), encoding="utf-8").read().strip(), ""]
        h = open(os.path.join(src, "hidden_test.py"), encoding="utf-8").read()
        h = re.sub(r"^class Hidden\(", f"class Hidden{k}(", h, flags=re.M)
        hidden.append(f"# ---- blocker {k}: {p}\n" + h)
    # README edits that tickets ask for are graded on the README of the bundle
    ref_readme = []
    for p in parts:
        r = os.path.join(OUT, p, "ref", "README.md")
        ref_readme.append(open(r, encoding="utf-8").read().replace("# ", "## ", 1) if os.path.exists(r)
                          else open(os.path.join(OUT, p, "repo", "README.md"), encoding="utf-8").read().replace("# ", "## ", 1))
    t.repo("README.md", "# release train\n\nSeveral small projects released together.\n\n" + "\n".join(readme))
    t.ref("README.md", "# release train\n\nSeveral small projects released together.\n\n" + "\n".join(ref_readme))
    t.issue("\n".join(issue) + "\n")
    t._w("hidden_test.py", "\n\n".join(hidden))


INTRO = '''
Release blockers. This repository holds several small projects that ship together; each blocker
below is its own ticket for one of them (they are independent). Fix all of them. Each project has
its own tests under `tests/`; the whole suite (`python3 -m unittest discover -s tests`) must pass at
the end.
'''


@task
def release_a():
    """ci-triage + prod-incidents + etl-pipeline + issue-triage in one repo."""
    _bundle("release-a", ["ci-triage", "prod-incidents", "etl-pipeline", "issue-triage"], INTRO)


@task
def release_b():
    """wide-rename + api-v2-migration + legacy-report + config-validator in one repo."""
    _bundle("release-b", ["wide-rename", "api-v2-migration", "legacy-report", "config-validator"], INTRO)


# ---------------------------------------------------------------------------------------------
if __name__ == "__main__":
    names = sys.argv[1:] or sorted(TASKS)
    for name in sorted(names, key=lambda n: n.startswith("release-")):  # bundles copy their parts
        TASKS[name]()
        print("generated", name)
