"""Parse access-log lines of the form:

    2026-10-01T12:00:00+03:00 GET /api/items 200 123ms
"""
from datetime import datetime


def parse_line(line):
    parts = line.split()
    ts = datetime.strptime(parts[0][:19], "%Y-%m-%dT%H:%M:%S")
    return {
        "time": ts,
        "method": parts[1],
        "path": parts[2],
        "status": int(parts[3]),
        "latency_ms": int(parts[4].rstrip("ms")),
    }


def p95_latency(lines):
    values = sorted(parse_line(l)["latency_ms"] for l in lines)
    return values[int(len(values) * 0.95)]
