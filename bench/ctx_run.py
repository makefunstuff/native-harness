#!/usr/bin/env python3
"""HRN-2 A/B: does letting the d3 decision model manage the agent's context help?

Both arms: the human's pi (same install, a copy of its config without the llama-native link),
model deepseek/deepseek-flash, same thinking level, same limits, the long tickets in
bench/tasks-long. Arm `d3` additionally loads extension/d3-context (pi -e).

usage: bench/ctx_run.py ARM [--rounds N] [--first-round K] [--tasks a,b] [--jobs J]
  ARM: base | d3 | d3-27b   (the d3 arms need D3_URL, e.g. http://127.0.0.1:18190/v1, serving
       vllm-d3-flash for `d3` and vllm-d3 for `d3-27b`; D3_MODEL is set from the arm)

Writes results/ctx/raw/<ARM>.jsonl (one row per run, resumable) and per-run files under
results/ctx/raw/<ARM>/ (the extension's decision log, the final diff, pi's stderr tail).
pi sessions (full transcripts) go to ~/.cache/native-harness/ctx-sessions, outside the repo.
"""
import argparse, concurrent.futures as cf, glob, json, os, shutil, subprocess, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
TASKS = os.path.join(HERE, "tasks-long")
RAW = os.path.join(REPO, "results", "ctx", "raw")
CACHE = os.path.expanduser("~/.cache/native-harness")
WORK = os.path.join(CACHE, "ctx-work")
SESS = os.path.join(CACHE, "ctx-sessions")
TMP = os.path.join(CACHE, "tmp")
AGENT_DIR = os.path.join(CACHE, "pi-agent-d3")
MODEL = "deepseek/deepseek-flash"
THINKING = "medium"
TIMEOUT = 2400
PREAMBLE = ("You are working autonomously in this repository; nobody will answer questions. "
            "Read the code, make the change, run the tests, and stop when the work is done.\n\n")
# deepseek-flash list prices, USD per 1M tokens (api-docs.deepseek.com/quick_start/pricing, read
# 2026-10-18; peak rates, used for every run so the arms compare; off-peak is half)
PRICE = {"hit": 0.006, "miss": 0.30, "out": 1.20}
lock = threading.Lock()


def sh(cmd, cwd, timeout=180):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout,
                          env=dict(os.environ, TMPDIR=TMP))


def call_key(c):
    return json.dumps([c.get("name"), c.get("arguments")], sort_keys=True)


def removed_then_rerun(sess_dir, d3log):
    """Calls whose output d3 removed (drop or summarise) and that the agent later made again, identically:
    the clearest sign that it needed what was taken away."""
    if not os.path.exists(d3log):
        return 0, []
    removed = {}
    for line in open(d3log):
        r = json.loads(line)
        if r.get("kind") == "apply":
            for it in r["items"]:
                removed[it["key"]] = it["label"]
    calls, order = {}, []
    for f in glob.glob(os.path.join(sess_dir, "*.jsonl")):
        for line in open(f):
            m = json.loads(line).get("message") or {}
            if m.get("role") == "assistant":
                for c in m.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "toolCall":
                        calls[c["id"]] = call_key(c)
                        order.append(c["id"])
    hits = []
    for key, label in removed.items():
        if key in calls and key in order:
            later = order[order.index(key) + 1:]
            if any(calls[k] == calls[key] for k in later):
                hits.append(label)
    return len(hits), hits


def session_stats(sess_dir):
    s = {"turns": 0, "tool_calls": 0, "tool_errors": 0, "in_miss": 0, "in_hit": 0, "out": 0, "reasoning": 0,
         "ctx": [], "compactions": 0, "stop": None, "provider_errors": 0, "repeat_calls": 0}
    seen_calls = set()
    for f in glob.glob(os.path.join(sess_dir, "*.jsonl")):
        for line in open(f):
            d = json.loads(line)
            if d.get("type") == "compaction":
                s["compactions"] += 1
            m = d.get("message") or {}
            if m.get("role") == "assistant":
                u = m.get("usage") or {}
                s["turns"] += 1
                s["in_miss"] += u.get("input", 0)
                s["in_hit"] += u.get("cacheRead", 0)
                s["out"] += u.get("output", 0)
                s["reasoning"] += u.get("reasoning", 0)
                if u.get("input", 0) + u.get("cacheRead", 0):
                    s["ctx"].append(u.get("input", 0) + u.get("cacheRead", 0) + u.get("cacheWrite", 0))
                s["stop"] = m.get("stopReason")
                s["provider_errors"] += m.get("stopReason") == "error"
                for c in m.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "toolCall":
                        s["tool_calls"] += 1
                        key = call_key(c)
                        s["repeat_calls"] += key in seen_calls  # the same call (tool + arguments) again
                        seen_calls.add(key)
            elif m.get("role") == "toolResult" and m.get("isError"):
                s["tool_errors"] += 1
    ctx = s.pop("ctx")
    s["ctx_peak"] = max(ctx) if ctx else 0
    s["ctx_mean"] = round(sum(ctx) / len(ctx)) if ctx else 0
    s["tokens_processed"] = s["in_miss"] + s["in_hit"] + s["out"]
    s["cost_usd"] = round((s["in_miss"] * PRICE["miss"] + s["in_hit"] * PRICE["hit"] + s["out"] * PRICE["out"]) / 1e6, 5)
    return s


def d3_stats(path):
    s = {"d3_calls": 0, "d3_ms": 0, "d3_checks": 0, "d3_applies": 0, "d3_boundary_applies": 0, "d3_pressure_applies": 0,
         "d3_dropped": 0, "d3_summarised": 0, "d3_saved_chars": 0, "d3_errors": 0, "reasoning_chars_sent": 0}
    if not os.path.exists(path):
        return s
    for line in open(path):
        r = json.loads(line)
        k = r.get("kind")
        if k in ("decide", "pin"):
            s["d3_calls"] += 1
            s["d3_ms"] += r.get("ms", 0)
        elif k == "check":
            s["d3_checks"] += 1
        elif k == "apply":
            s["d3_applies"] += 1
            s["d3_boundary_applies"] += r.get("reason") == "boundary"
            s["d3_pressure_applies"] += r.get("reason") == "pressure"
            s["d3_saved_chars"] += r.get("saved_chars", 0)
            for it in r.get("items", []):
                s["d3_dropped"] += it["decision"] == "drop"
                s["d3_summarised"] += it["decision"] == "summarise"
        elif k == "error":
            s["d3_errors"] += 1
        elif k == "request":
            s["reasoning_chars_sent"] = max(s["reasoning_chars_sent"], r.get("reasoning_chars", 0))
    return s


def run_task(arm, task, rnd):
    tdir = os.path.join(TASKS, task)
    name = f"{task}-r{rnd}"
    work = os.path.join(WORK, arm, name)
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    shutil.copytree(os.path.join(tdir, "repo"), work, dirs_exist_ok=True)
    sh("git init -q && git add -A && git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm init", work)
    out = os.path.join(RAW, arm)
    os.makedirs(out, exist_ok=True)
    sess = os.path.join(SESS, arm, name)
    shutil.rmtree(sess, ignore_errors=True)
    os.makedirs(sess)
    d3log = os.path.join(out, name + ".d3.jsonl")
    if os.path.exists(d3log):
        os.remove(d3log)
    env = dict(os.environ, PI_CODING_AGENT_DIR=AGENT_DIR, D3_LOG=d3log, NH_TMPDIR=os.path.join(TMP, f"{arm}-{name}"))
    cmd = [os.path.join(REPO, "scripts", "pi.sh"), "-p", "--mode", "json", "--model", f"{MODEL}:{THINKING}", "--session-dir", sess]
    if arm.startswith("d3"):
        cmd += ["-e", os.path.join(REPO, "extension", "d3-context", "index.ts")]
        env["D3_MODEL"] = {"d3": "vllm-d3-flash", "d3-27b": "vllm-d3"}[arm]
    prompt = PREAMBLE + open(os.path.join(tdir, "issue.md")).read()
    t0 = time.time()
    try:
        p = subprocess.run(cmd + [prompt], cwd=work, capture_output=True, text=True, timeout=TIMEOUT, env=env,
                           stdin=subprocess.DEVNULL)
        rc, timed_out = p.returncode, False
        open(os.path.join(out, name + ".stderr"), "w").write(p.stderr[-20000:])
    except subprocess.TimeoutExpired:
        rc, timed_out = None, True
    wall = round(time.time() - t0, 1)
    diff = sh("git add -A && git diff --cached --stat | tail -1 && git diff --cached", work).stdout
    open(os.path.join(out, name + ".diff"), "w").write(diff)
    shutil.copy(os.path.join(tdir, "hidden_test.py"), work)
    try:
        h = sh("python3 -m unittest hidden_test", work, timeout=300)
        passed, tail = h.returncode == 0, (h.stdout + h.stderr)[-1500:]
    except subprocess.TimeoutExpired:
        passed, tail = False, "hidden tests timed out"
    row = {"arm": arm, "task": task, "round": rnd, "passed": passed, "wall_s": wall, "rc": rc, "timed_out": timed_out,
           "diffstat": diff.splitlines()[0] if diff else "", **session_stats(sess), **d3_stats(d3log), "hidden_tail": tail[-600:]}
    row["removed_rerun"], row["removed_rerun_labels"] = removed_then_rerun(sess, d3log)
    shutil.rmtree(work, ignore_errors=True)
    shutil.rmtree(env["NH_TMPDIR"], ignore_errors=True)
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("arm", choices=["base", "d3", "d3-27b"])
    ap.add_argument("--rounds", type=int, default=1)
    ap.add_argument("--first-round", type=int, default=1)
    ap.add_argument("--tasks", default="")
    ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args()
    if a.arm.startswith("d3") and not os.environ.get("D3_URL"):
        raise SystemExit("D3_URL is not set")
    if not os.path.isdir(TASKS):  # generated, not committed
        subprocess.run(["python3", os.path.join(HERE, "gen_long_tasks.py")], check=True)
    tasks = a.tasks.split(",") if a.tasks else sorted(os.listdir(TASKS))
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)
    path = os.path.join(RAW, f"{a.arm}.jsonl")
    done = {(json.loads(l)["task"], json.loads(l)["round"]) for l in open(path)} if os.path.exists(path) else set()
    todo = [(t, r) for r in range(a.first_round, a.first_round + a.rounds) for t in tasks if (t, r) not in done]
    with open(path, "a") as f, cf.ThreadPoolExecutor(a.jobs) as ex:
        futs = {ex.submit(run_task, a.arm, t, r): (t, r) for t, r in todo}
        for fu in cf.as_completed(futs):
            r = fu.result()
            with lock:
                f.write(json.dumps(r) + "\n")
                f.flush()
            print(f"{a.arm} {r['task']} r{r['round']} {'PASS' if r['passed'] else 'FAIL'} {r['wall_s']}s turns={r['turns']} "
                  f"peak={r['ctx_peak']} mean={r['ctx_mean']} proc={r['tokens_processed']} ${r['cost_usd']} "
                  f"applies={r['d3_applies']} d3ms={r['d3_ms']}{' TIMEOUT' if r['timed_out'] else ''}", flush=True)


if __name__ == "__main__":
    main()
