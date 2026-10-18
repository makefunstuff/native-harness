
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

ORIGINAL = '"""Scheduler for periodic jobs (tab-indented on purpose: house style)."""\nimport heapq\n\n\nclass Job:\n\tdef __init__(self, name, every, action):\n\t\tself.name = name\n\t\tself.every = every\n\t\tself.action = action\n\t\tself.runs = 0\n\t\tself.last = None\n\n\tdef due(self, now):\n\t\tif self.last is None:\n\t\t\treturn True\n\t\treturn now - self.last >= self.every\n\n\tdef run(self, now):\n\t\tself.runs += 1\n\t\tself.last = now\n\t\treturn self.action()\n\n\nclass Scheduler:\n\tdef __init__(self):\n\t\tself.jobs = {}\n\t\tself.log = []\n\n\tdef add(self, job):\n\t\tif job.name in self.jobs:\n\t\t\traise ValueError("duplicate job " + job.name)\n\t\tself.jobs[job.name] = job\n\n\tdef remove(self, name):\n\t\tdel self.jobs[name]\n\n\tdef tick(self, now):\n\t\tresults = {}\n\t\tfor name in sorted(self.jobs):\n\t\t\tjob = self.jobs[name]\n\t\t\tif job.due(now):\n\t\t\t\ttry:\n\t\t\t\t\tresults[name] = job.run(now)\n\t\t\t\texcept Exception as e:\n\t\t\t\t\tself.log.append((now, name, repr(e)))\n\t\t\t\t\tresults[name] = None\n\t\treturn results\n\n\tdef next_due(self, now):\n\t\theap = []\n\t\tfor job in self.jobs.values():\n\t\t\tat = now if job.last is None else job.last + job.every\n\t\t\theapq.heappush(heap, (at, job.name))\n\t\treturn heap[0] if heap else None\n\n\ndef report_0(scheduler, now):\n\t"""Summary 0: jobs whose period is a multiple of 2."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 2 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_1(scheduler, now):\n\t"""Summary 1: jobs whose period is a multiple of 3."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 3 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_2(scheduler, now):\n\t"""Summary 2: jobs whose period is a multiple of 4."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 4 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_3(scheduler, now):\n\t"""Summary 3: jobs whose period is a multiple of 5."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 5 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_4(scheduler, now):\n\t"""Summary 4: jobs whose period is a multiple of 6."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 6 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_5(scheduler, now):\n\t"""Summary 5: jobs whose period is a multiple of 7."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 7 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_6(scheduler, now):\n\t"""Summary 6: jobs whose period is a multiple of 8."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 8 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_7(scheduler, now):\n\t"""Summary 7: jobs whose period is a multiple of 9."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 9 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_8(scheduler, now):\n\t"""Summary 8: jobs whose period is a multiple of 10."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 10 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_9(scheduler, now):\n\t"""Summary 9: jobs whose period is a multiple of 11."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 11 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_10(scheduler, now):\n\t"""Summary 10: jobs whose period is a multiple of 12."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 12 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_11(scheduler, now):\n\t"""Summary 11: jobs whose period is a multiple of 13."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 13 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_12(scheduler, now):\n\t"""Summary 12: jobs whose period is a multiple of 14."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 14 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_13(scheduler, now):\n\t"""Summary 13: jobs whose period is a multiple of 15."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 15 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_14(scheduler, now):\n\t"""Summary 14: jobs whose period is a multiple of 16."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 16 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_15(scheduler, now):\n\t"""Summary 15: jobs whose period is a multiple of 17."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 17 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_16(scheduler, now):\n\t"""Summary 16: jobs whose period is a multiple of 18."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 18 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n\ndef report_17(scheduler, now):\n\t"""Summary 17: jobs whose period is a multiple of 19."""\n\tlines = []\n\tfor name in sorted(scheduler.jobs):\n\t\tjob = scheduler.jobs[name]\n\t\tif job.every % 19 == 0:\n\t\t\tstate = "due" if job.due(now) else "waiting"\n\t\t\tlines.append(name + ": " + state + " (" + str(job.runs) + " runs)")\n\treturn "\\n".join(lines)\n\n'

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
        check_untouched(self, "jobs.py", ORIGINAL, {"Scheduler.tick", "Scheduler.remove", "Scheduler.__init__", "report_7", "Scheduler", "Job.__init__", "Job"})


if __name__ == "__main__":
    unittest.main()
