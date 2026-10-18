#!/usr/bin/env python3
"""Candidates for "forgot something it needed": an output the d3 extension removed whose file is read
again within the next 3 agent turns after the edit took effect, plus every agent message that
mentions the removal. Base runs: the same window after a random earlier point is not meaningful, so
the base rate is the share of file-reading outputs re-read within 3 turns of their own call.

usage: bench/ctx_quick_refetch.py [--show]
"""
import glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ctx_forgot import PATH, READERS, RAW, SESS

WINDOW = 3


def turns(sess_dir):
    out = []
    for f in sorted(glob.glob(os.path.join(sess_dir, "*.jsonl"))):
        for line in open(f):
            m = json.loads(line).get("message") or {}
            if m.get("role") != "assistant":
                continue
            text = " ".join(c.get("text") or c.get("thinking") or "" for c in m["content"] if c.get("type") in ("text", "thinking"))
            cs = []
            for c in m["content"]:
                if c.get("type") == "toolCall":
                    a = c.get("arguments") or {}
                    cmd = a.get("command") or a.get("code") or a.get("path") or ""
                    paths = {os.path.normpath(p) for p in PATH.findall(cmd)} if (c["name"] == "read" or READERS.search(cmd)) else set()
                    cs.append((c["id"], paths, cmd))
            out.append((text, cs))
    return out


def main():
    show = "--show" in sys.argv
    for arm in ("base", "d3", "d3-27b"):
        p = os.path.join(RAW, f"{arm}.jsonl")
        if not os.path.exists(p):
            continue
        n_items = n_hits = n_mention = 0
        for row in map(json.loads, open(p)):
            if row["round"] < 1:
                continue
            name = f"{row['task']}-r{row['round']}"
            ts = turns(os.path.join(SESS, arm, name))
            where = {cid: (ti, paths) for ti, (_, cs) in enumerate(ts) for cid, paths, _ in cs}
            n_mention += sum("d3-context" in t or "removed from the context" in t for t, _ in ts)
            if arm == "base":
                for cid, (ti, paths) in where.items():
                    if not paths:
                        continue
                    n_items += 1
                    n_hits += any(paths & q for _, (tj, q) in where.items() if ti < tj <= ti + WINDOW)
                continue
            log = os.path.join(RAW, arm, name + ".d3.jsonl")
            for line in open(log):
                r = json.loads(line)
                if r.get("kind") != "apply":
                    continue
                at = r["turn"]  # the check ran at this turn; the edit is in the requests after it
                for it in r["items"]:
                    if it["key"] not in where or not where[it["key"]][1]:
                        continue
                    n_items += 1
                    paths = where[it["key"]][1]
                    later = [(tj, cmd) for tj, (_, cs) in enumerate(ts) for _, q, cmd in cs if at <= tj < at + WINDOW and paths & q]
                    if later:
                        n_hits += 1
                        if show:
                            print(f"{arm} {name} turn {at}: {it['decision']} {it['label'][:70]}\n    -> turn {later[0][0] + 1}: {later[0][1][:110]}")
        print(f"{arm}: {n_items} file outputs {'removed' if arm != 'base' else '(all)'}, {n_hits} re-read within {WINDOW} turns "
              f"({100 * n_hits / max(1, n_items):.0f}%); agent messages mentioning a removal: {n_mention}")


if __name__ == "__main__":
    main()
