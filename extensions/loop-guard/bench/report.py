#!/usr/bin/env python3
"""Summarise bench/results/<label>.jsonl as markdown tables, one per label: base vs guard.

usage: bench/report.py [LABEL...]   (default: every results file)
"""
import glob, json, os, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def pct(a, b):
    return f"{100 * a / b:.1f} %" if b else "-"


def summary(rows):
    s = lambda k: sum(r.get(k, 0) or 0 for r in rows)
    calls, turns = s("calls"), s("turns")
    return {
        "runs": len(rows),
        "passed": f"{s('passed')}/{len(rows)}",
        "tool calls / run": f"{calls / len(rows):.1f}" if rows else "-",
        "tool error rate": pct(s("errors"), calls),
        "exact retry of a failed call": f"{s('exactRetry')} ({pct(s('exactRetry'), calls)})",
        "notes: retry / repeat / streak": f"{s('note_retry')} / {s('note_repeat')} / {s('note_streak')}",
        "runs ending on a stall": f"{s('stall')}",
        "stall nudges sent": f"{s('nudge_stall')}",
        "timeouts": f"{s('timed_out')}",
        "median wall time": f"{statistics.median(r['wall_s'] for r in rows):.0f} s" if rows else "-",
    }


def main():
    labels = sys.argv[1:] or sorted(os.path.basename(p)[:-6] for p in glob.glob(os.path.join(HERE, "results", "*.jsonl")))
    for label in labels:
        rows = [json.loads(l) for l in open(os.path.join(HERE, "results", f"{label}.jsonl"))]
        arms = {a: summary([r for r in rows if r["arm"] == a]) for a in ("base", "guard")}
        tasks = sorted({r["task"] for r in rows})
        rounds = max(r["round"] for r in rows)
        print(f"### {label} ({len(tasks)} tickets, {rounds} rounds)\n")
        print("| | without loop-guard | with loop-guard |\n|---|---:|---:|")
        for k in arms["base"]:
            print(f"| {k} | {arms['base'][k]} | {arms['guard'][k]} |")
        print("\nper ticket, passed (base / guard):", ", ".join(
            f"{t} {sum(r['passed'] for r in rows if r['task'] == t and r['arm'] == 'base')}/"
            f"{sum(r['passed'] for r in rows if r['task'] == t and r['arm'] == 'guard')}" for t in tasks))
        print()


if __name__ == "__main__":
    main()
