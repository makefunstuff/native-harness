import unittest
from datetime import timezone
from logstats.parser import parse_line


class ParseTest(unittest.TestCase):
    def test_fields(self):
        r = parse_line("2026-10-01T12:00:00Z GET /a 200 15ms")
        self.assertEqual(r["method"], "GET")
        self.assertEqual(r["status"], 200)
        self.assertEqual(r["latency_ms"], 15)

    def test_offset_converted_to_utc(self):
        r = parse_line("2026-10-01T12:00:00+03:00 GET /a 200 15ms")
        self.assertEqual(r["time"].tzinfo, timezone.utc)
        self.assertEqual(r["time"].hour, 9)


if __name__ == "__main__":
    unittest.main()
