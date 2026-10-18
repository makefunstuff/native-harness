#!/usr/bin/env python3
"""Generates the edit-heavy tickets under bench/tasks/ (deterministic; the output is committed).

Each ticket is a repo/ with one large module, an issue.md, and a hidden_test.py that checks the
requested behaviour AND that every function the ticket does not ask to change is still there,
unchanged (AST-equal to the original): the "destructive edit" check.
"""
import os, shutil, textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
TASKS = os.path.join(HERE, "tasks")

GUARD = '''
import ast, os, unittest

def _defs(src):
    out = {}
    def walk(node, prefix=""):
        for n in ast.iter_child_nodes(node):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                name = prefix + n.name
                if isinstance(n, ast.ClassDef):
                    walk(n, name + ".")
                    body = [b for b in n.body if not isinstance(b, (ast.FunctionDef, ast.AsyncFunctionDef))]
                    out[name] = ast.dump(ast.Module(body=body, type_ignores=[]))
                else:
                    out[name] = ast.dump(n)
    walk(ast.parse(src))
    return out

def check_untouched(test, path, original, allowed):
    now = _defs(open(path).read())
    old = _defs(original)
    for name, dump in old.items():
        if name in allowed or any(name.startswith(a + ".") for a in allowed):
            continue
        test.assertIn(name, now, f"{name} was removed from {path}")
        test.assertEqual(now[name], dump, f"{name} in {path} was changed, but the ticket did not ask for it")
'''


def write(task, files, issue, hidden, ref):
    """ref: {file: [(old, new), ...]} applied to the repo gives the reference solution (ref/)."""
    d = os.path.join(TASKS, task)
    shutil.rmtree(d, ignore_errors=True)
    for rel, body in files.items():
        for kind in ("repo", "ref"):
            if kind == "ref":
                for old, new in ref.get(rel, []):
                    assert body.count(old) == 1, (task, rel, old)
                    body = body.replace(old, new)
            p = os.path.join(d, kind, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "w").write(body)
    open(os.path.join(d, "issue.md"), "w").write(textwrap.dedent(issue).lstrip())
    open(os.path.join(d, "hidden_test.py"), "w").write(hidden)


# ---------------------------------------------------------------- handlers: near-duplicate blocks
def handlers():
    kinds = ["user", "order", "invoice", "refund", "shipment", "coupon", "review", "address", "payment",
             "session", "cart", "wishlist", "ticket", "subscription", "report", "webhook"]
    parts = ['"""Request handlers for the shop API. Each handler validates, loads, and serialises one resource."""\n',
             "import json\n\n\nclass NotFound(Exception):\n    pass\n\n\nclass Invalid(Exception):\n    pass\n\n"]
    for k in kinds:
        cls = k.capitalize() + "Handler"
        parts.append(f'''
class {cls}:
    """Handles /{k}s requests."""

    resource = "{k}"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("{k}: payload must be an object")
        if "id" not in payload:
            raise Invalid("{k}: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("{k}", ident))
            if item is not None:
                return item
        raise NotFound("{k} " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "{k}"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)
''')
    src = "".join(parts)
    files = {"shop/handlers.py": src, "shop/__init__.py": "",
             "tests/test_handlers.py": textwrap.dedent('''
                import json, unittest
                from shop.handlers import OrderHandler, UserHandler, Invalid, NotFound

                class T(unittest.TestCase):
                    def test_user(self):
                        h = UserHandler({("user", 1): {"name": "a"}})
                        self.assertEqual(json.loads(h.handle({"id": 1})), {"name": "a", "type": "user"})

                    def test_missing(self):
                        with self.assertRaises(NotFound):
                            OrderHandler({}).handle({"id": 2})

                if __name__ == "__main__":
                    unittest.main()
                ''').lstrip()}
    issue = """
    In `shop/handlers.py`, three handlers need changes; leave every other handler exactly as it is.

    1. `RefundHandler.validate` must also reject a payload whose `amount` is present and negative:
       raise `Invalid("refund: negative amount")`.
    2. `ShipmentHandler.serialise` must add `"tracking": item.get("tracking", "")` to the output
       (keep the `type` key).
    3. `CouponHandler.load` must upper-case string ids before looking them up (`"ab"` -> `"AB"`);
       non-string ids are looked up unchanged.

    Add tests for the three changes to `tests/test_handlers.py`.
    Run the tests with: python3 -m unittest discover -s tests
    """
    hidden = GUARD + f'''
ORIGINAL = {src!r}

import json
from shop.handlers import RefundHandler, ShipmentHandler, CouponHandler, UserHandler, Invalid, NotFound


class Hidden(unittest.TestCase):
    def test_refund_negative(self):
        h = RefundHandler({{("refund", 1): {{"x": 1}}}})
        with self.assertRaises(Invalid):
            h.validate({{"id": 1, "amount": -5}})
        self.assertTrue(h.validate({{"id": 1, "amount": 5}}))
        self.assertTrue(h.validate({{"id": 1}}))

    def test_shipment_tracking(self):
        h = ShipmentHandler({{("shipment", 3): {{"tracking": "Z9"}}, ("shipment", 4): {{}}}})
        self.assertEqual(json.loads(h.handle({{"id": 3}}))["tracking"], "Z9")
        out = json.loads(h.handle({{"id": 4}}))
        self.assertEqual(out["tracking"], "")
        self.assertEqual(out["type"], "shipment")

    def test_coupon_upper(self):
        h = CouponHandler({{("coupon", "AB"): {{"v": 1}}, ("coupon", 7): {{"v": 2}}}})
        self.assertEqual(json.loads(h.handle({{"id": "ab"}}))["v"], 1)
        self.assertEqual(json.loads(h.handle({{"id": 7}}))["v"], 2)

    def test_others_untouched(self):
        check_untouched(self, "shop/handlers.py", ORIGINAL,
                        {{"RefundHandler.validate", "ShipmentHandler.serialise", "CouponHandler.load"}})


if __name__ == "__main__":
    unittest.main()
'''
    ref = {"shop/handlers.py": [
        ('raise Invalid("refund: missing id")\n        return True',
         'raise Invalid("refund: missing id")\n        if payload.get("amount") is not None and payload["amount"] < 0:\n            raise Invalid("refund: negative amount")\n        return True'),
        ('data["type"] = "shipment"', 'data["type"] = "shipment"\n        data["tracking"] = item.get("tracking", "")'),
        ('    def load(self, ident):\n        self.calls += 1\n        for attempt in range(self.retries):\n            item = self.store.get(("coupon", ident))',
         '    def load(self, ident):\n        self.calls += 1\n        if isinstance(ident, str):\n            ident = ident.upper()\n        for attempt in range(self.retries):\n            item = self.store.get(("coupon", ident))'),
    ]}
    write("edit-handlers", files, issue, hidden, ref)


# ---------------------------------------------------------------- tabs: a tab-indented module
def tabs():
    body = ['"""Scheduler for periodic jobs (tab-indented on purpose: house style)."""\n',
            "import heapq\n\n\nclass Job:\n\tdef __init__(self, name, every, action):\n\t\tself.name = name\n"
            "\t\tself.every = every\n\t\tself.action = action\n\t\tself.runs = 0\n\t\tself.last = None\n\n"
            "\tdef due(self, now):\n\t\tif self.last is None:\n\t\t\treturn True\n\t\treturn now - self.last >= self.every\n\n"
            "\tdef run(self, now):\n\t\tself.runs += 1\n\t\tself.last = now\n\t\treturn self.action()\n\n\n"]
    body.append("""class Scheduler:
\tdef __init__(self):
\t\tself.jobs = {}
\t\tself.log = []

\tdef add(self, job):
\t\tif job.name in self.jobs:
\t\t\traise ValueError("duplicate job " + job.name)
\t\tself.jobs[job.name] = job

\tdef remove(self, name):
\t\tdel self.jobs[name]

\tdef tick(self, now):
\t\tresults = {}
\t\tfor name in sorted(self.jobs):
\t\t\tjob = self.jobs[name]
\t\t\tif job.due(now):
\t\t\t\ttry:
\t\t\t\t\tresults[name] = job.run(now)
\t\t\t\texcept Exception as e:
\t\t\t\t\tself.log.append((now, name, repr(e)))
\t\t\t\t\tresults[name] = None
\t\treturn results

\tdef next_due(self, now):
\t\theap = []
\t\tfor job in self.jobs.values():
\t\t\tat = now if job.last is None else job.last + job.every
\t\t\theapq.heappush(heap, (at, job.name))
\t\treturn heap[0] if heap else None

""")
    for i in range(18):
        body.append(f"""
def report_{i}(scheduler, now):
\t\"\"\"Summary {i}: jobs whose period is a multiple of {i + 2}.\"\"\"
\tlines = []
\tfor name in sorted(scheduler.jobs):
\t\tjob = scheduler.jobs[name]
\t\tif job.every % {i + 2} == 0:
\t\t\tstate = "due" if job.due(now) else "waiting"
\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
\treturn "\\n".join(lines)

""")
    src = "".join(body)
    files = {"jobs.py": src, "tests/test_jobs.py": textwrap.dedent('''
        import unittest, sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from jobs import Job, Scheduler

        class T(unittest.TestCase):
            def test_tick(self):
                s = Scheduler()
                s.add(Job("a", 10, lambda: 1))
                self.assertEqual(s.tick(0), {"a": 1})
                self.assertEqual(s.tick(5), {})

        if __name__ == "__main__":
            unittest.main()
        ''').lstrip()}
    issue = """
    `jobs.py` (tab-indented; keep it that way) needs three changes. Do not touch anything else.

    1. `Scheduler.tick` must stop calling a job after it has failed 3 times in a row: count
       consecutive failures per job (reset on success) and skip the job once the count reaches 3.
       Failures are still logged as they are now.
    2. `Scheduler.remove` of an unknown name must raise `KeyError("no job <name>")` with that message.
    3. `report_7` must also include jobs that are due, whatever their period: a job is listed when
       its period is a multiple of 9 OR it is due now.

    Add tests to `tests/test_jobs.py`. Run them with: python3 -m unittest discover -s tests
    """
    hidden = GUARD + f'''
ORIGINAL = {src!r}

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
spec = importlib.util.spec_from_file_location("jobs_mod", os.path.join(os.path.dirname(os.path.abspath(__file__)), "jobs.py"))
sched = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sched)


class Hidden(unittest.TestCase):
    def test_failures_stop(self):
        calls = []
        def bad():
            calls.append(1)
            raise RuntimeError("x")
        s = sched.Scheduler()
        s.add(sched.Job("b", 1, bad))
        for t in range(6):
            s.tick(t)
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(s.log), 3)

    def test_failure_reset(self):
        n = [0]
        def flaky():
            n[0] += 1
            if n[0] % 3 == 0:
                return "ok"
            raise RuntimeError("x")
        s = sched.Scheduler()
        s.add(sched.Job("f", 1, flaky))
        for t in range(9):
            s.tick(t)
        self.assertEqual(n[0], 9)

    def test_remove_unknown(self):
        s = sched.Scheduler()
        with self.assertRaises(KeyError) as cm:
            s.remove("zz")
        self.assertIn("no job zz", str(cm.exception))

    def test_report_7(self):
        s = sched.Scheduler()
        s.add(sched.Job("nine", 9, lambda: 1))
        s.add(sched.Job("five", 5, lambda: 1))
        s.add(sched.Job("six", 6, lambda: 1))
        s.tick(0)
        out = sched.report_7(s, 5)
        self.assertIn("five: due", out)
        self.assertIn("nine: waiting", out)
        self.assertNotIn("six", out)

    def test_tabs_kept(self):
        src = open("jobs.py").read()
        self.assertFalse(any(l.startswith("    ") for l in src.splitlines()), "space-indented lines in jobs.py")

    def test_others_untouched(self):
        check_untouched(self, "jobs.py", ORIGINAL, {{"Scheduler.tick", "Scheduler.remove", "Scheduler.__init__", "report_7", "Scheduler", "Job.__init__", "Job"}})


if __name__ == "__main__":
    unittest.main()
'''
    ref = {"jobs.py": [
        ("\t\tself.jobs = {}\n\t\tself.log = []\n", "\t\tself.jobs = {}\n\t\tself.log = []\n\t\tself.failures = {}\n"),
        ("\tdef remove(self, name):\n\t\tdel self.jobs[name]",
         "\tdef remove(self, name):\n\t\tif name not in self.jobs:\n\t\t\traise KeyError(\"no job \" + name)\n\t\tdel self.jobs[name]"),
        ("\t\t\tif job.due(now):\n\t\t\t\ttry:\n\t\t\t\t\tresults[name] = job.run(now)\n\t\t\t\texcept Exception as e:\n\t\t\t\t\tself.log.append((now, name, repr(e)))\n\t\t\t\t\tresults[name] = None",
         "\t\t\tif self.failures.get(name, 0) >= 3:\n\t\t\t\tcontinue\n\t\t\tif job.due(now):\n\t\t\t\ttry:\n\t\t\t\t\tresults[name] = job.run(now)\n\t\t\t\t\tself.failures[name] = 0\n\t\t\t\texcept Exception as e:\n\t\t\t\t\tself.log.append((now, name, repr(e)))\n\t\t\t\t\tself.failures[name] = self.failures.get(name, 0) + 1\n\t\t\t\t\tresults[name] = None"),
        ("\t\tif job.every % 9 == 0:", "\t\tif job.every % 9 == 0 or job.due(now):"),
    ]}
    write("edit-tabs", files, issue, hidden, ref)


# ---------------------------------------------------------------- table: long literal lines
def table():
    rows = []
    countries = ["at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "hu", "ie", "it", "lv",
                 "lt", "lu", "mt", "nl", "pl", "pt", "ro", "sk", "si", "es", "se"]
    for i, c in enumerate(countries):
        std = 17 + (i * 7) % 11
        red = 5 + (i * 3) % 9
        rows.append(f'    "{c}": {{"standard": {std}, "reduced": [{red}, {red + 4}], "currency": "EUR", "name_en": "{c.upper()} country {i}", "notes": "rate table entry {i}, updated 2026-01-01; see the official journal for the legal text"}},\n')
    src = ('"""VAT rates per EU country (a long table) and helpers."""\n\nRATES = {\n' + "".join(rows) + "}\n\n\n"
           + textwrap.dedent('''
            def rate(country, kind="standard"):
                entry = RATES[country.lower()]
                if kind == "standard":
                    return entry["standard"]
                if kind == "reduced":
                    return min(entry["reduced"])
                raise ValueError("unknown kind " + kind)


            def gross(net, country, kind="standard"):
                return round(net * (1 + rate(country, kind) / 100), 2)


            def countries_above(threshold):
                return sorted(c for c, e in RATES.items() if e["standard"] > threshold)
            ''').lstrip())
    files = {"vat.py": src, "tests/test_vat.py": textwrap.dedent('''
        import unittest, sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        import vat

        class T(unittest.TestCase):
            def test_gross(self):
                self.assertEqual(vat.gross(100, "AT"), 100 + vat.RATES["at"]["standard"])

        if __name__ == "__main__":
            unittest.main()
        ''').lstrip()}
    issue = """
    Updates to `vat.py`. Change only what is listed; every other table entry must stay byte-for-byte
    the same (the table is diffed against the official journal).

    1. `"fi"`: standard rate is now 26 (was 24), and its notes become
       `"rate table entry 8, updated 2026-09-01"`.
    2. `"ee"`: reduced rates are now `[9, 13]`.
    3. `"sk"`: standard rate is now 23.
    4. `rate()` gets a new kind `"super_reduced"`: return the entry's `"super_reduced"` value when the
       entry has one, else raise `ValueError("no super-reduced rate for <country>")`. Add
       `"super_reduced": 4.8` to the `"fr"` entry (keep the other keys of that entry as they are).

    Add tests to `tests/test_vat.py`. Run them with: python3 -m unittest discover -s tests
    """
    hidden = f'''
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vat

ORIGINAL = {src!r}


class Hidden(unittest.TestCase):
    def test_values(self):
        self.assertEqual(vat.RATES["fi"]["standard"], 26)
        self.assertEqual(vat.RATES["fi"]["notes"], "rate table entry 8, updated 2026-09-01")
        self.assertEqual(vat.RATES["ee"]["reduced"], [9, 13])
        self.assertEqual(vat.RATES["sk"]["standard"], 23)
        self.assertEqual(vat.RATES["fr"]["super_reduced"], 4.8)
        self.assertEqual(vat.rate("FR", "super_reduced"), 4.8)
        with self.assertRaises(ValueError) as cm:
            vat.rate("de", "super_reduced")
        self.assertIn("no super-reduced rate for de", str(cm.exception))
        self.assertEqual(vat.rate("de", "reduced"), min(vat.RATES["de"]["reduced"]))

    def test_other_lines_untouched(self):
        now = open("vat.py").read().splitlines()
        changed = ('"fi"', '"ee"', '"sk"', '"fr"')
        for line in ORIGINAL.splitlines():
            if line.startswith('    "') and not line.startswith(tuple("    " + c for c in changed)):
                self.assertIn(line, now, "table line changed or removed: " + line[:40])
        self.assertEqual(len(vat.RATES), 27)
        for k in ("countries_above", "gross"):
            self.assertTrue(callable(getattr(vat, k)))
        self.assertEqual(vat.countries_above(100), [])


if __name__ == "__main__":
    unittest.main()
'''
    import re
    def sub_line(c, f):
        line = next(l for l in src.splitlines(True) if l.startswith(f'    "{c}"'))
        return (line, f(line))
    ref = {"vat.py": [
        sub_line("fi", lambda l: re.sub(r'"standard": \d+', '"standard": 26', l).replace("rate table entry 8, updated 2026-01-01; see the official journal for the legal text", "rate table entry 8, updated 2026-09-01")),
        sub_line("ee", lambda l: re.sub(r'"reduced": \[[^]]*\]', '"reduced": [9, 13]', l)),
        sub_line("sk", lambda l: re.sub(r'"standard": \d+', '"standard": 23', l)),
        sub_line("fr", lambda l: l.replace('"currency"', '"super_reduced": 4.8, "currency"')),
        ('        return min(entry["reduced"])\n', '        return min(entry["reduced"])\n    if kind == "super_reduced":\n        if "super_reduced" not in entry:\n            raise ValueError("no super-reduced rate for " + country)\n        return entry["super_reduced"]\n'),
    ]}
    write("edit-table", files, issue, hidden, ref)


if __name__ == "__main__":
    handlers()
    tabs()
    table()
    print("ok")
