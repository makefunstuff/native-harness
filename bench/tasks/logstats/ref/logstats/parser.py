import math
from datetime import datetime, timezone


def parse_line(line):
    parts = line.split()
    if len(parts) != 5 or not parts[4].endswith("ms"):
        raise ValueError(f"malformed line: {line!r}")
    ts = datetime.fromisoformat(parts[0].replace("Z", "+00:00"))
    if ts.tzinfo is None:
        raise ValueError("timestamp without offset")
    return {"time": ts.astimezone(timezone.utc), "method": parts[1], "path": parts[2],
            "status": int(parts[3]), "latency_ms": int(parts[4][:-2])}


def p95_latency(lines):
    values = sorted(parse_line(l)["latency_ms"] for l in lines)
    if not values:
        raise ValueError("no samples")
    return values[math.ceil(0.95 * len(values)) - 1]
