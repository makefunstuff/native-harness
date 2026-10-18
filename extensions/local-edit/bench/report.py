#!/usr/bin/env python3
"""Tables from results/*.jsonl -> results/summary.md (and stdout)."""
import glob, json, os, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "results")
EDIT_TICKETS = {"edit-handlers", "edit-tabs", "edit-table"}


def load():
    arms = {}
    for f in sorted(glob.glob(os.path.join(RESULTS, "*.jsonl"))):
        rows = [json.loads(l) for l in open(f) if l.strip()]
        if rows:
            arms[os.path.basename(f)[:-6]] = rows
    return arms


def frac(n, d):
    return f"{n}/{d}" + (f" ({100 * n / d:.1f}%)" if d else "")


def kinds(rows):
    k = {}
    for r in rows:
        for a, b in r.get("edit_error_kinds", {}).items():
            k[a] = k.get(a, 0) + b
    return ", ".join(f"{a} {b}" for a, b in sorted(k.items())) or "–"


def arm_table(arms):
    out = ["| arm | model | runs | hidden tests pass | edit calls | edit errors | error kinds | placed loosely | paths repaired | "
           "edits dropping ≥3 lines | untouched-code check failed | collateral lines | median wall s |",
           "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for arm, rows in arms.items():
        n = len(rows)
        calls = sum(r["edit_calls"] for r in rows)
        errs = sum(r["edit_errors"] for r in rows)
        edit_rows = [r for r in rows if r["task"] in EDIT_TICKETS]
        coll = [r["collateral_lines"] for r in rows if r.get("collateral_lines") is not None]
        out.append(
            f"| {arm} | {rows[0]['model']} | {n} | {frac(sum(r['passed'] for r in rows), n)} | {calls} | {frac(errs, calls)} | {kinds(rows)} | "
            f"{sum(r['tolerant_matches'] for r in rows)} | {sum(r['path_repairs'] for r in rows)} | "
            f"{sum(r['edits_dropping_3plus'] for r in rows)} | {sum(bool(r.get('untouched_broken')) for r in edit_rows)}/{len(edit_rows)} | "
            f"{sum(coll)} | {statistics.median([r['wall_s'] for r in rows]):.0f} |")
    return "\n".join(out)


def task_table(arms):
    tasks = sorted({r["task"] for rows in arms.values() for r in rows})
    names = list(arms)
    out = ["| task | " + " | ".join(f"{a} pass · edit errors/calls" for a in names) + " |", "|---|" + "---|" * len(names)]
    for t in tasks:
        cells = []
        for a in names:
            rs = [r for r in arms[a] if r["task"] == t]
            cells.append(f"{sum(r['passed'] for r in rs)}/{len(rs)} · {sum(r['edit_errors'] for r in rs)}/{sum(r['edit_calls'] for r in rs)}" if rs else "–")
        out.append(f"| {t} | " + " | ".join(cells) + " |")
    return "\n".join(out)


def main():
    arms = load()
    if not arms:
        print("no results")
        return
    md = "# local-edit bench results\n\n" + arm_table(arms) + "\n\n## Per ticket\n\n" + task_table(arms) + "\n"
    open(os.path.join(RESULTS, "summary.md"), "w").write(md)
    print(md)


if __name__ == "__main__":
    main()
