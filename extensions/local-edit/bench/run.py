#!/usr/bin/env python3
"""local-edit benchmark: pi works coding tickets headless (pi -p) with pi's own edit tool (base) or
with local-edit (-e this checkout's extension); hidden tests grade the final tree.

usage: bench/run.py ARM --model PROVIDER/ID[:thinking] --edit base|local-edit
                        [--rounds N] [--first-round K] [--tasks t1,t2] [--capability-suite DIR]

Tickets:
  - the seven of experimental/llama-native/bench/tasks (repo/, issue.md, hidden_test.py, ref/);
  - the three edit-heavy ones of bench/tasks (gen_tasks.py: large files, tab indentation,
    near-duplicate blocks, long lines; their hidden tests also fail when code the ticket did not
    ask to change was changed or removed);
  - with --capability-suite (homelab evals/local-ai-campaign-2026-09-08/capability-suite), its three
    code tasks, graded by the suite's frozen validators.

Per run it records the hidden-test result and, from the pi session, every edit call: errors (by
kind), tolerant matches and path repairs made by local-edit, and edits that removed non-blank lines
without putting them back ("dropped" lines, from pi's own diff, so both arms are measured the same
way). For tickets with a reference solution it also counts "collateral" lines: lines the original
and the reference share that are missing from the agent's final tree.

Runs on a copy of ~/.pi/agent (no sessions), refreshed per arm, so the real config is never
touched. Writes results/<ARM>.jsonl (resumable); sessions, diffs and logs go to
~/.cache/pi-extras/local-edit/ (outside the repo: they hold the full prompt and tool output).
"""
import argparse, collections, glob, json, os, re, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(EXT))
TASK_DIRS = [os.path.join(REPO, "experimental", "llama-native", "bench", "tasks"), os.path.join(HERE, "tasks")]
RESULTS = os.path.join(HERE, "results")
CACHE = os.path.expanduser(os.environ.get("LOCAL_EDIT_BENCH_CACHE", "~/.cache/pi-extras/local-edit"))
PREAMBLE = ("You are working autonomously in this repository; nobody will answer questions. "
            "Read the code, make the change, run the tests, and stop when the work is done.\n\n")
CAP_TASKS = {
    "event_reconcile": {"seed": [], "validator": "event_reconcile_test.py"},
    "schedule_repair": {"seed": ["fixture_broken/sweep.py"], "validator": "schedule_repair_test.py"},
    "api_migration": {"seed": ["fixture_original/http_util.py", "fixture_original/cli.py", "fixture_original/legacy_calls.py"],
                      "validator": "api_migration_test.py"},
}
CAP_SUFFIX = ("\n\nThere is no runner here: work on the files in the current directory directly. Write unittest tests for your work in tests/ "
              "and run them with: python3 -m unittest discover -s tests\n")


def sh(cmd, cwd, timeout=180, env=None):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout, env=env)


def agent_copy(arm):
    src = os.environ.get("PI_AGENT_SRC", os.path.expanduser("~/.pi/agent"))
    dest = os.path.join(CACHE, "pi-agent", arm)
    shutil.rmtree(dest, ignore_errors=True)
    shutil.copytree(src, dest, symlinks=True,
                    ignore=lambda d, names: [n for n in names if n == "sessions" or n.endswith("~") or ".pre-" in n or ".bak" in n])
    os.makedirs(os.path.join(dest, "sessions"), exist_ok=True)
    os.chmod(dest, 0o700)
    return dest


def tickets(args):
    out = {}
    for root in TASK_DIRS:
        for t in sorted(os.listdir(root)):
            if os.path.isdir(os.path.join(root, t, "repo")):
                out[t] = {"kind": "bench", "dir": os.path.join(root, t)}
    if args.capability_suite:
        for t in CAP_TASKS:
            out[t] = {"kind": "capability", "dir": os.path.join(args.capability_suite, "tasks", t)}
    if args.tasks:
        out = {k: v for k, v in out.items() if k in args.tasks.split(",")}
    return out


def prepare(ticket, name, work):
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    if ticket["kind"] == "bench":
        shutil.copytree(os.path.join(ticket["dir"], "repo"), work, dirs_exist_ok=True)
        issue = open(os.path.join(ticket["dir"], "issue.md")).read()
    else:
        for s in CAP_TASKS[name]["seed"]:
            shutil.copy(os.path.join(ticket["dir"], s), work)
        issue = open(os.path.join(ticket["dir"], "task.md")).read() + CAP_SUFFIX
    sh("git init -q && git add -A && git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm init", work)
    return PREAMBLE + issue


def grade(ticket, name, work, args):
    if ticket["kind"] == "bench":
        shutil.copy(os.path.join(ticket["dir"], "hidden_test.py"), work)
        h = sh("python3 -m unittest hidden_test", work, timeout=180)
        os.remove(os.path.join(work, "hidden_test.py"))
    else:
        validator = os.path.join(args.capability_suite, "validators", CAP_TASKS[name]["validator"])
        h = subprocess.run([sys.executable, validator, work], capture_output=True, text=True, timeout=180,
                           env={"PATH": "/usr/bin:/bin", "HOME": "/tmp"}, cwd=work)
    out = h.stdout + h.stderr
    failed = sorted(set(re.findall(r"^(?:FAIL|ERROR): (\w+)", out, re.M)))
    return h.returncode == 0, out[-600:], failed


def norm(s):
    return re.sub(r"\s+", " ", s.strip())


def collateral(ticket, work):
    """Lines the original repo and the reference solution share that the final tree lost."""
    ref = os.path.join(ticket["dir"], "ref")
    if ticket["kind"] != "bench" or not os.path.isdir(ref):
        return None
    lost = 0
    orig_root = os.path.join(ticket["dir"], "repo")
    for dirpath, _, files in os.walk(orig_root):
        for f in files:
            rel = os.path.relpath(os.path.join(dirpath, f), orig_root)
            if rel.startswith("tests" + os.sep) or not os.path.exists(os.path.join(ref, rel)):
                continue
            try:
                o = collections.Counter(norm(l) for l in open(os.path.join(orig_root, rel)) if norm(l))
                r = collections.Counter(norm(l) for l in open(os.path.join(ref, rel)) if norm(l))
                now = collections.Counter(norm(l) for l in open(os.path.join(work, rel)) if norm(l)) if os.path.exists(os.path.join(work, rel)) else collections.Counter()
            except UnicodeDecodeError:
                continue
            keep = o & r
            lost += sum((keep - now).values())
    return lost


def diff_dropped(diff):
    """Non-blank lines a successful edit removed and did not re-add (pi's display diff)."""
    rem, add = [], set()
    for line in (diff or "").split("\n"):
        m = re.match(r"^([+-])\s*\d+ ?(.*)$", line)
        if not m:
            continue
        if m.group(1) == "-":
            rem.append(norm(m.group(2)))
        else:
            add.add(norm(m.group(2)))
    return sum(1 for r in rem if r and r not in add)


def classify_error(text):
    t = text.lower()
    if "could not find" in t:
        return "not_found"
    if "occurrences" in t or "matches" in t and "places" in t or "several places" in t:
        return "ambiguous"
    if "enoent" in t or "file not found" in t or "could not edit file" in t:
        return "path"
    if "validation" in t or "invalid" in t:
        return "arguments"
    if "no changes made" in t:
        return "no_change"
    if "overlap" in t:
        return "overlap"
    return "other"


def session_stats(sess_dir):
    st = {"assistant_turns": 0, "tool_calls": 0, "tool_errors": 0, "edit_calls": 0, "edit_errors": 0,
          "edit_error_kinds": {}, "write_calls": 0, "tolerant_matches": 0, "path_repairs": 0, "drop_warnings": 0,
          "edits_dropping_3plus": 0, "dropped_lines": 0, "output_tokens": 0, "input_tokens": 0,
          "cache_read_tokens": 0, "stop": None}
    calls = {}
    for f in glob.glob(os.path.join(sess_dir, "*.jsonl")):
        for line in open(f):
            d = json.loads(line)
            m = d.get("message") or {}
            if m.get("role") == "assistant":
                st["assistant_turns"] += 1
                u = m.get("usage") or {}
                st["output_tokens"] += u.get("output", 0)
                st["input_tokens"] += u.get("input", 0)
                st["cache_read_tokens"] += u.get("cacheRead", 0)
                st["stop"] = m.get("stopReason")
                for c in m.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "toolCall":
                        st["tool_calls"] += 1
                        calls[c.get("id")] = c
            elif m.get("role") == "toolResult":
                tool = m.get("toolName")
                text = " ".join(c.get("text", "") for c in m.get("content") or [] if isinstance(c, dict))
                st["write_calls"] += tool == "write"
                if m.get("isError"):
                    st["tool_errors"] += 1
                if tool != "edit":
                    continue
                st["edit_calls"] += 1
                if m.get("isError"):
                    st["edit_errors"] += 1
                    k = classify_error(text)
                    st["edit_error_kinds"][k] = st["edit_error_kinds"].get(k, 0) + 1
                    continue
                st["tolerant_matches"] += len(re.findall(r"matched (lines? [\d-]+) \(|decoded literal", text))
                st["path_repairs"] += len(re.findall(r'path "[^"]*" (resolved to|taken as)', text))
                st["drop_warnings"] += "were removed and not re-added" in text or "placeholder comment" in text
                dropped = diff_dropped((m.get("details") or {}).get("diff"))
                st["dropped_lines"] += dropped
                st["edits_dropping_3plus"] += dropped >= 3
    return st


def run_one(arm, args, agent_dir, name, ticket, rnd):
    run = f"{name}-r{rnd}"
    work = os.path.join(CACHE, "work", arm, run)
    sess = os.path.join(CACHE, "sessions", arm, run)
    logs = os.path.join(CACHE, "logs", arm)
    shutil.rmtree(sess, ignore_errors=True)
    os.makedirs(sess)
    os.makedirs(logs, exist_ok=True)
    prompt = prepare(ticket, name, work)
    # no board / status-bar side effects from the copied config's extensions
    env = {k: v for k, v in os.environ.items() if not re.match(r"^(HERDR|ORCA)_", k)}
    env.update(PI_CODING_AGENT_DIR=agent_dir, TMPDIR=os.path.join(CACHE, "tmp"))
    os.makedirs(env["TMPDIR"], exist_ok=True)
    cmd = [os.environ.get("PI_BIN", "pi"), "-p", "--mode", "json", "--model", args.model, "--session-dir", sess]
    if args.edit == "local-edit":
        cmd += ["-e", os.path.join(EXT, "index.ts")]
    t0 = time.time()
    try:
        p = subprocess.run(cmd + [prompt], cwd=work, capture_output=True, text=True, timeout=args.timeout, env=env)
        rc, timed_out = p.returncode, False
        open(os.path.join(logs, run + ".stderr"), "w").write(p.stderr[-20000:])
    except subprocess.TimeoutExpired:
        rc, timed_out = None, True
    wall = round(time.time() - t0, 1)
    open(os.path.join(logs, run + ".diff"), "w").write(sh("git add -A && git diff --cached", work).stdout)
    passed, tail, failed_tests = grade(ticket, name, work, args)
    row = {"arm": arm, "model": args.model, "edit": args.edit, "task": name, "round": rnd, "passed": passed,
           "collateral_lines": collateral(ticket, work),
           "failed_tests": failed_tests, "untouched_broken": any("untouched" in t or "tabs_kept" in t for t in failed_tests), "wall_s": wall, "agent_rc": rc, "timed_out": timed_out,
           **session_stats(sess), "hidden_tail": tail[-300:].replace(work, ".").replace(os.path.expanduser("~"), "~")}
    shutil.rmtree(work, ignore_errors=True)
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("arm")
    ap.add_argument("--model", required=True)
    ap.add_argument("--edit", default="local-edit", choices=["base", "local-edit"])
    ap.add_argument("--rounds", type=int, default=1)
    ap.add_argument("--first-round", type=int, default=1)
    ap.add_argument("--tasks", default="")
    ap.add_argument("--capability-suite", default=os.environ.get("LOCAL_EDIT_CAPABILITY_SUITE", ""))
    ap.add_argument("--timeout", type=int, default=1800)
    args = ap.parse_args()
    os.makedirs(RESULTS, exist_ok=True)
    out = os.path.join(RESULTS, f"{args.arm}.jsonl")
    done = set()
    if os.path.exists(out):
        done = {(json.loads(l)["task"], json.loads(l)["round"]) for l in open(out) if l.strip()}
    agent_dir = agent_copy(args.arm)
    todo = tickets(args)
    with open(out, "a") as f:
        for rnd in range(args.first_round, args.first_round + args.rounds):
            for name, ticket in todo.items():
                if (name, rnd) in done:
                    continue
                r = run_one(args.arm, args, agent_dir, name, ticket, rnd)
                f.write(json.dumps(r) + "\n")
                f.flush()
                print(f"{args.arm} {name} r{rnd} {'PASS' if r['passed'] else 'FAIL'} {r['wall_s']}s "
                      f"edits={r['edit_calls']} errors={r['edit_errors']} {r['edit_error_kinds']} tolerant={r['tolerant_matches']} "
                      f"paths={r['path_repairs']} dropped={r['dropped_lines']} collateral={r['collateral_lines']}"
                      f"{' TIMEOUT' if r['timed_out'] else ''}", flush=True)


if __name__ == "__main__":
    main()
