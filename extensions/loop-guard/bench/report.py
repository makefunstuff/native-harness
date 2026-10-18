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


def inject_report(label, rows):
    scen = sorted({r["scenario"] for r in rows})
    rounds = max(r["round"] for r in rows)
    print(f"### {label} (injection, {rounds} rounds per scenario and arm)\n")
    print("| scenario | arm | passed | model repeats the failed call at once | identical repeats in all | model turns (median) | guard notes / nudges |")
    print("|---|---|---:|---:|---:|---:|---:|")
    for sc in scen:
        for arm in ("base", "guard"):
            rs = [r for r in rows if r["scenario"] == sc and r["arm"] == arm]
            if not rs:
                continue
            notes = sum(r["note_retry"] + r["note_repeat"] + r["note_streak"] for r in rs)
            print(f"| {sc} | {'with' if arm == 'guard' else 'without'} | {sum(r['passed'] for r in rs)}/{len(rs)} | "
                  f"{sum(r['first_call_repeats'] for r in rs)}/{len(rs)} | {sum(r['repeats_total'] for r in rs)} | "
                  f"{statistics.median(r['model_turns'] for r in rs):.0f} | {notes} / {sum(r['nudge_stall'] for r in rs)} |")
    print()


def main():
    labels = sys.argv[1:] or sorted(os.path.basename(p)[:-6] for p in glob.glob(os.path.join(HERE, "results", "*.jsonl")))
    for label in labels:
        rows = [json.loads(l) for l in open(os.path.join(HERE, "results", f"{label}.jsonl"))]
        # runs cut short by a provider error were run again; keep the last row per run
        last = {}
        for r in rows:
            last[(r["arm"], r.get("scenario", r["task"]), r["round"])] = r
        rows = [r for r in last.values() if not r.get("provider_error")]
        if rows and "scenario" in rows[0]:
            inject_report(label, rows)
            continue
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
