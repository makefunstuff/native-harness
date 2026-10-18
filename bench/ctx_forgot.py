#!/usr/bin/env python3
"""Look for "forgot something it needed" in the HRN-2 transcripts.

For every output the d3 extension removed (dropped or shortened), find later tool calls that read
one of the same files again (cat/sed/head/tail/grep/read naming the same path). For the base arm,
the same count over all earlier reads gives the background rate of going back to a file.
Prints one line per run and a per-arm total; --show lists the d3 cases to read in the transcripts.

usage: bench/ctx_forgot.py [--show]
"""
import glob, json, os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(REPO, "results", "ctx", "raw")
SESS = os.path.expanduser("~/.cache/native-harness/ctx-sessions")
PATH = re.compile(r"[\w./-]+\.(?:py|md|json|csv|txt|log|diff|ini)\b")
READERS = re.compile(r"\b(cat|sed|head|tail|grep|less|awk|wc|nl)\b")


def calls(sess_dir):
    out = []
    for f in sorted(glob.glob(os.path.join(sess_dir, "*.jsonl"))):
        for line in open(f):
            m = json.loads(line).get("message") or {}
            if m.get("role") == "assistant":
                for c in m.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "toolCall":
                        a = c.get("arguments") or {}
                        text = a.get("command") or a.get("code") or a.get("path") or ""
                        reads = c.get("name") == "read" or bool(READERS.search(text))
                        paths = {os.path.normpath(p) for p in PATH.findall(text)} if reads else set()
                        if c.get("name") == "read" and a.get("path"):
                            paths.add(os.path.normpath(a["path"]))
                        out.append({"id": c["id"], "paths": paths, "text": text[:160]})
    return out


def removed(d3log):
    r = {}
    if os.path.exists(d3log):
        for line in open(d3log):
            x = json.loads(line)
            if x.get("kind") == "apply":
                for it in x["items"]:
                    r[it["key"]] = (it["label"], it["decision"], x["turn"])
    return r


def main():
    show = "--show" in sys.argv
    tot = {}
    for arm in ("base", "d3", "d3-27b"):
        p = os.path.join(RAW, f"{arm}.jsonl")
        if not os.path.exists(p):
            continue
        n_runs = n_items = n_back = 0
        for row in map(json.loads, open(p)):
            if row["round"] < 1:
                continue
            name = f"{row['task']}-r{row['round']}"
            cs = calls(os.path.join(SESS, arm, name))
            idx = {c["id"]: i for i, c in enumerate(cs)}
            if arm.startswith("d3"):
                items = removed(os.path.join(RAW, arm, name + ".d3.jsonl"))
            else:  # every earlier call that read files counts as "could have been removed"
                items = {c["id"]: (c["text"], "read", None) for c in cs if c["paths"]}
            back = []
            for key, (label, dec, turn) in items.items():
                if key not in idx or not cs[idx[key]]["paths"]:
                    continue
                n_items += 1
                later = [c for c in cs[idx[key] + 1:] if c["paths"] & cs[idx[key]]["paths"]]
                if later:
                    back.append((label, dec, sorted(cs[idx[key]]["paths"] & later[0]["paths"]), later[0]["text"]))
            n_runs += 1
            n_back += len(back)
            print(f"{arm} {name}: {len(back)} of {len([k for k in items if k in idx and cs[idx[k]]['paths']])} file-reading outputs were followed by a re-read of the same file")
            if show and arm.startswith("d3"):
                for b in back:
                    print(f"    {b[1]}: {b[0][:90]}\n      -> re-read {b[2]}: {b[3][:120]}")
        tot[arm] = (n_runs, n_items, n_back)
    for arm, (r, i, b) in tot.items():
        print(f"TOTAL {arm}: {r} runs, {i} file-reading outputs {'removed by d3' if arm.startswith('d3') else '(all)'}, "
              f"{b} followed by a re-read of the same file ({100 * b / max(1, i):.0f}%)")


if __name__ == "__main__":
    main()
