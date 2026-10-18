#!/usr/bin/env python3
"""Benchmark: the human's pi (same install, same config copy) works coding tickets with its normal
tools; hidden tests grade the final tree. One "arm" = a provider plus a set of experiments.

usage: bench/run.py ARM --provider llama.cpp|llama-native [--exp prune,done-check] [--rounds N]
                        [--tasks t1,t2] [--thinking medium]

For llama.cpp the baseline server and logging proxy must be running (scripts/baseline-up.sh);
for llama-native nothing may hold the GPUs (pi loads the model itself, once per task process).

Writes results/raw/<ARM>/<task>-r<k>.{metrics.jsonl,session/,diff} and appends one row per run to
results/raw/<ARM>.jsonl (resumable: finished task/round pairs are skipped).
"""
import argparse, glob, json, os, shutil, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
TASKS = os.path.join(HERE, "tasks")
RAW = os.path.join(REPO, "results", "raw")
WORK = os.path.expanduser("~/.cache/native-harness/work")
RUN = os.path.expanduser("~/.cache/native-harness/run")
TIMEOUT = 1800
PREAMBLE = ("You are working autonomously in this repository; nobody will answer questions. "
            "Read the code, make the change, run the tests, and stop when the work is done.\n\n")


def sh(cmd, cwd, timeout=180):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout)


class VramSampler(threading.Thread):
    """Peak VRAM used per GPU while a run is going (whole device: includes other processes)."""

    def __init__(self):
        super().__init__(daemon=True)
        self.peak = {}
        self.stop = False

    def run(self):
        while not self.stop:
            try:
                out = subprocess.run(["nvidia-smi", "--query-gpu=index,memory.used", "--format=csv,noheader,nounits"],
                                     capture_output=True, text=True, timeout=10).stdout
                for line in out.strip().splitlines():
                    i, u = [x.strip() for x in line.split(",")]
                    self.peak[f"gpu{i}"] = max(self.peak.get(f"gpu{i}", 0), int(u))
            except Exception:
                pass
            time.sleep(2)


def session_stats(sess_dir):
    st = {"assistant_turns": 0, "tool_calls": 0, "tool_errors": 0, "edit_calls": 0, "edit_errors": 0,
          "malformed_calls": 0, "output_tokens": 0, "stop": None, "provider_errors": 0, "nudges": 0}
    tool_names = set()
    for f in glob.glob(os.path.join(sess_dir, "*.jsonl")):
        for line in open(f):
            d = json.loads(line)
            m = d.get("message") or {}
            if d.get("type") == "custom_message" or m.get("customType") == "llama-native-done-check":
                st["nudges"] += m.get("customType") == "llama-native-done-check" or d.get("customType") == "llama-native-done-check"
            if m.get("role") == "assistant":
                st["assistant_turns"] += 1
                st["output_tokens"] += (m.get("usage") or {}).get("output", 0)
                st["stop"] = m.get("stopReason")
                st["provider_errors"] += m.get("stopReason") == "error"
                for c in m.get("content") or []:
                    if not isinstance(c, dict):
                        continue
                    if c.get("type") == "toolCall":
                        st["tool_calls"] += 1
                    if c.get("type") == "text" and ("<tool_call>" in c.get("text", "") or "<function=" in c.get("text", "")):
                        st["malformed_calls"] += 1  # a tool call left as text
            elif m.get("role") == "toolResult":
                tool = m.get("toolName")
                st["edit_calls"] += tool == "edit"
                if m.get("isError"):
                    st["tool_errors"] += 1
                    st["edit_errors"] += tool == "edit"
                    txt = " ".join(c.get("text", "") for c in m.get("content") or [] if isinstance(c, dict))
                    if "Validation failed" in txt or "not found" in txt.lower() and "tool" in txt.lower():
                        st["malformed_calls"] += 1  # arguments that did not validate / unknown tool
    return st


def metric_stats(path):
    """Normalise the per-request records of the proxy (HTTP) and of the extension (native)."""
    s = {"requests": 0, "prompt_total": 0, "prompt_processed": 0, "prompt_reused": 0, "refed": 0, "generated": 0,
         "drafted": 0, "draft_accepted": 0, "ttft_ms": [], "request_ms": 0.0, "prompt_ms": 0.0, "gen_ms": 0.0,
         "decide": [], "prune": [], "compact": [], "load_ms": None, "parse_errors": 0, "max_prompt": 0, "errors": 0}
    if not os.path.exists(path):
        return s
    for line in open(path):
        r = json.loads(line)
        k = r.get("kind", "chat")
        if k == "load":
            s["load_ms"] = r.get("ms")
            continue
        if k in ("decide", "prune", "compact", "compacted"):
            s.setdefault(k, []).append(r)
            continue
        if r.get("error"):
            s["errors"] += 1
            continue
        t = r.get("timings")
        if not t:
            continue  # e.g. the 1-token decision request seen by the proxy (counted under "decide")
        s["requests"] += 1
        if "prompt_decoded" in t:  # native
            processed, reused, total = t.get("prompt_decoded", 0), t.get("cache_n", 0), t.get("prompt_n", 0)
            s["refed"] += t.get("refed", 0)
            s["prompt_ms"] += t.get("prompt_ms", 0)
        else:  # llama-server: prompt_n = tokens processed, cache_n = tokens reused
            processed, reused = t.get("prompt_n", 0), t.get("cache_n", 0)
            total = processed + reused
            s["prompt_ms"] += t.get("prompt_ms", 0)
        s["prompt_total"] += total
        s["prompt_processed"] += processed
        s["prompt_reused"] += reused
        s["max_prompt"] = max(s["max_prompt"], total)
        s["generated"] += t.get("predicted_n", 0)
        s["drafted"] += t.get("draft_n", 0)
        s["draft_accepted"] += t.get("draft_n_accepted", 0)
        s["gen_ms"] += t.get("predicted_ms", 0)
        s["request_ms"] += r.get("total_ms") or 0
        if r.get("ttft_ms") is not None:
            s["ttft_ms"].append(r["ttft_ms"])
        s["parse_errors"] += 1 if r.get("parse_error") else 0
    return s


def run_task(arm, args, task, rnd):
    tdir = os.path.join(TASKS, task)
    name = f"{task}-r{rnd}"
    work = os.path.join(WORK, arm, name)
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    shutil.copytree(os.path.join(tdir, "repo"), work, dirs_exist_ok=True)
    sh("git init -q && git add -A && git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm init", work)
    out = os.path.join(RAW, arm)
    os.makedirs(out, exist_ok=True)
    sess = os.path.join(out, name + ".session")
    shutil.rmtree(sess, ignore_errors=True)
    os.makedirs(sess)
    metrics = os.path.join(out, name + ".metrics.jsonl")
    if os.path.exists(metrics):
        os.remove(metrics)
    # point both loggers at this run's metrics file
    for base in ("proxy.jsonl", "native.jsonl"):
        open(os.path.join(RUN, base + ".target"), "w").write(metrics)
    env = dict(os.environ)
    env["LLAMA_NATIVE_METRICS"] = os.path.join(RUN, "native.jsonl")
    env["LLAMA_NATIVE_EXP"] = args.exp or ""
    prompt = PREAMBLE + open(os.path.join(tdir, "issue.md")).read()
    model = f"{args.provider}/qwen3.8-27b" + (f":{args.thinking}" if args.thinking else "")
    vs = VramSampler()
    vs.start()
    t0 = time.time()
    try:
        p = subprocess.run([os.path.join(REPO, "scripts", "pi.sh"), "-p", "--mode", "json", "--model", model,
                            "--session-dir", sess, prompt], cwd=work, capture_output=True, text=True,
                           timeout=TIMEOUT, env=env)
        agent_rc, timed_out = p.returncode, False
        open(os.path.join(out, name + ".stderr"), "w").write(p.stderr[-20000:])
    except subprocess.TimeoutExpired:
        agent_rc, timed_out = None, True
    wall = round(time.time() - t0, 1)
    vs.stop = True
    diff = sh("git add -A && git diff --cached --stat | tail -1 && git diff --cached", work).stdout
    open(os.path.join(out, name + ".diff"), "w").write(diff)
    shutil.copy(os.path.join(tdir, "hidden_test.py"), work)
    try:
        h = sh("python3 -m unittest hidden_test", work, timeout=180)
        passed, tail = h.returncode == 0, (h.stdout + h.stderr)[-1500:]
    except subprocess.TimeoutExpired:
        passed, tail = False, "hidden tests timed out"
    ms = metric_stats(metrics)
    load_s = (ms["load_ms"] or 0) / 1000
    row = {"arm": arm, "provider": args.provider, "exp": args.exp or "", "task": task, "round": rnd, "passed": passed,
           "wall_s": wall, "wall_minus_load_s": round(wall - load_s, 1), "load_s": round(load_s, 1),
           "agent_rc": agent_rc, "timed_out": timed_out, "diffstat": diff.splitlines()[0] if diff else "",
           "vram_peak_mib": vs.peak, **session_stats(sess),
           **{k: v for k, v in ms.items() if k not in ("ttft_ms", "decide", "prune", "compact")},
           "ttft_ms": ms["ttft_ms"], "decide": ms["decide"], "prune": ms["prune"], "compact": ms["compact"],
           "hidden_tail": tail[-600:]}
    shutil.rmtree(work, ignore_errors=True)
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("arm")
    ap.add_argument("--provider", required=True, choices=["llama.cpp", "llama-native"])
    ap.add_argument("--exp", default="")
    ap.add_argument("--rounds", type=int, default=1)
    ap.add_argument("--first-round", type=int, default=1)
    ap.add_argument("--tasks", default="")
    ap.add_argument("--thinking", default="medium")
    args = ap.parse_args()
    tasks = args.tasks.split(",") if args.tasks else sorted(os.listdir(TASKS))
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(RUN, exist_ok=True)
    out = os.path.join(RAW, f"{args.arm}.jsonl")
    done = set()
    if os.path.exists(out):
        done = {(json.loads(l)["task"], json.loads(l)["round"]) for l in open(out)}
    with open(out, "a") as f:
        for rnd in range(args.first_round, args.first_round + args.rounds):
            for t in tasks:
                if (t, rnd) in done:
                    continue
                r = run_task(args.arm, args, t, rnd)
                f.write(json.dumps(r) + "\n")
                f.flush()
                print(f"{args.arm} {t} r{rnd} {'PASS' if r['passed'] else 'FAIL'} {r['wall_s']}s (load {r['load_s']}s) "
                      f"turns={r['assistant_turns']} calls={r['tool_calls']} err={r['tool_errors']} "
                      f"malformed={r['malformed_calls']} proc={r['prompt_processed']} reused={r['prompt_reused']} "
                      f"gen={r['generated']}{' TIMEOUT' if r['timed_out'] else ''}", flush=True)


if __name__ == "__main__":
    main()
