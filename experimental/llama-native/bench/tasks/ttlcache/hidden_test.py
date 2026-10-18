import threading, time, unittest
from ttlcache import TTLCache


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def run_threads(n, target):
    barrier = threading.Barrier(n)
    out, errs = [], []

    def w():
        barrier.wait()
        try:
            out.append(target())
        except Exception as e:
            errs.append(e)
    ts = [threading.Thread(target=w) for _ in range(n)]
    for t in ts: t.start()
    for t in ts: t.join(10)
    return out, errs


class Hidden(unittest.TestCase):
    def test_single_flight(self):
        c, calls = TTLCache(60), []

        def slow():
            calls.append(1); time.sleep(0.3); return 42
        out, errs = run_threads(20, lambda: c.get_or_compute("k", slow))
        self.assertEqual(errs, [])
        self.assertEqual(out, [42] * 20)
        self.assertEqual(len(calls), 1)

    def test_keys_parallel(self):
        c = TTLCache(60)
        keys = iter(range(100)); lock = threading.Lock()

        def nxt():
            with lock: return next(keys)
        t0 = time.monotonic()
        out, errs = run_threads(8, lambda: c.get_or_compute(nxt(), lambda: time.sleep(0.4) or 1))
        self.assertEqual(errs, [])
        self.assertEqual(len(out), 8)
        self.assertLess(time.monotonic() - t0, 1.5)

    def test_exception_shared_not_cached(self):
        c, calls = TTLCache(60), []

        def boom():
            calls.append(1); time.sleep(0.3); raise RuntimeError("db down")
        out, errs = run_threads(10, lambda: c.get_or_compute("k", boom))
        self.assertEqual(out, [])
        self.assertEqual(len(errs), 10)
        self.assertTrue(all(isinstance(e, RuntimeError) for e in errs))
        self.assertEqual(len(calls), 1)
        self.assertEqual(c.get_or_compute("k", lambda: 7), 7)

    def test_expiry_with_clock(self):
        clk = Clock()
        c, calls = TTLCache(10, clock=clk), []
        f = lambda: calls.append(1) or len(calls)
        self.assertEqual(c.get_or_compute("a", f), 1)
        clk.t += 9.9
        self.assertEqual(c.get_or_compute("a", f), 1)
        self.assertEqual(len(c), 1)
        clk.t += 0.2
        self.assertEqual(len(c), 0)
        self.assertEqual(c.get_or_compute("a", f), 2)
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
