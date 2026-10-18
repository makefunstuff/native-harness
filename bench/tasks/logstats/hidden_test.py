import math, random, unittest
from datetime import datetime, timezone
from logstats.parser import parse_line, p95_latency


def line(ms, ts="2026-10-01T12:00:00Z"):
    return f"{ts} GET /x 200 {ms}ms"


class Hidden(unittest.TestCase):
    def test_z_is_utc(self):
        r = parse_line(line(1, "2026-10-01T12:00:00Z"))
        self.assertEqual(r["time"], datetime(2026, 10, 1, 12, tzinfo=timezone.utc))
        self.assertEqual(r["time"].utcoffset().total_seconds(), 0)

    def test_positive_offset(self):
        r = parse_line(line(1, "2026-10-01T01:30:00+03:00"))
        self.assertEqual(r["time"], datetime(2026, 9, 30, 22, 30, tzinfo=timezone.utc))
        self.assertEqual(r["time"].utcoffset().total_seconds(), 0)

    def test_negative_offset(self):
        r = parse_line(line(1, "2026-10-01T20:00:00-05:00"))
        self.assertEqual(r["time"], datetime(2026, 10, 2, 1, 0, tzinfo=timezone.utc))

    def test_p95_nearest_rank(self):
        for n in (1, 2, 19, 20, 21, 100, 101):
            vals = list(range(1, n + 1))
            random.Random(n).shuffle(vals)
            expect = sorted(vals)[math.ceil(0.95 * n) - 1]
            self.assertEqual(p95_latency([line(v) for v in vals]), expect, n)

    def test_p95_empty(self):
        with self.assertRaises(ValueError):
            p95_latency([])

    def test_malformed(self):
        for bad in ["", "garbage", "2026-10-01T12:00:00Z GET /x", "2026-10-01T12:00:00Z GET /x abc 5ms",
                    "notatime GET /x 200 5ms", "2026-10-01T12:00:00Z GET /x 200 fast"]:
            with self.assertRaises(ValueError, msg=bad):
                parse_line(bad)


if __name__ == "__main__":
    unittest.main()
