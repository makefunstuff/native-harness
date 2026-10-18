#!/usr/bin/env python3
"""Before/after benchmark for loop-guard: pi works coding tickets headless (`pi -p`), once without
the extension (arm "base") and once with it (arm "guard", loaded with -e), on the same model and a
copy of the pi config. Hidden tests grade the final tree.

usage: bench/run.py --model PROVIDER/ID [--label NAME] [--rounds N] [--tasks t1,t2]
                    [--thinking medium] [--sets bench,traps] [--suite DIR] [--arms base,guard]

Tickets (repo/ + issue.md + hidden_test.py each): set "bench" is experimental/llama-native/bench/tasks/*,
set "traps" is bench/tasks/* of this extension (tickets whose obvious first call fails: a stale path
and test command, an edit target that appears twice, a test script without the exec bit). With
--suite, also the code tasks of a capability suite (tasks/<t>/task.md, validators/<t>_test.py and
runner/run_suite.py's CODE_TASKS, as in the homelab evals), seeded as files in the work dir.

The two arms alternate per ticket so both see the same server conditions. Each run's pi session
is replayed through loop-guard's rules (bench/replay.mjs) for exact retries, would-fire counts and
stall endings; notes the guard actually added are counted from the session.

Writes one row per run to bench/results/<label>.jsonl (resumable). Sessions, work dirs and the
config copy live under ~/.cache/pi-extras/loop-guard/, outside the repository.
"""
import argparse, glob, importlib.util, json, os, re, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(EXT))
TASK_SETS = {"bench": os.path.join(REPO, "experimental", "llama-native", "bench", "tasks"), "traps": os.path.join(HERE, "tasks")}
RESULTS = os.path.join(HERE, "results")
CACHE = os.path.expanduser("~/.cache/pi-extras/loop-guard")
AGENT = os.path.join(CACHE, "pi-agent")
TMP = os.path.join(CACHE, "tmp")
PREAMBLE = ("You are working autonomously in this repository; nobody will answer questions. "
            "Read the code, make the change, run the tests, and stop when the work is done.\n\n")
SUITE_NOTE = ("\n\nThe files mentioned above are in the current directory (if any already exist, change them "
              "there). Write the result as files in the current directory with your tools; ignore any "
              "instruction about output markers.\n")


def sh(cmd, cwd, timeout=180, env=None):
    os.makedirs(TMP, exist_ok=True)
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout,
                          env=dict(env or os.environ, TMPDIR=TMP))


def make_agent_copy():
    """A copy of ~/.pi/agent without sessions; any pi-extras install in it is dropped."""
    src = os.path.expanduser(os.environ.get("PI_AGENT_SRC", "~/.pi/agent"))
    os.makedirs(AGENT, exist_ok=True)
    subprocess.run(["rsync", "-a", "--delete", "--exclude", "sessions", "--exclude", "*~", f"{src}/", f"{AGENT}/"], check=True)
    os.makedirs(os.path.join(AGENT, "sessions"), exist_ok=True)
    os.chmod(AGENT, 0o700)
    p = os.path.join(AGENT, "settings.json")
    s = json.load(open(p)) if os.path.exists(p) else {}
    keep = lambda x: not re.search(r"pi-extras|native-harness", x if isinstance(x, str) else (x or {}).get("source", ""))
    s["packages"] = [x for x in s.get("packages", []) if keep(x)]
    s["extensions"] = [x for x in s.get("extensions", []) if keep(x)]
    json.dump(s, open(p, "w"), indent=2)


class Ticket:
    def __init__(self, name, seed, prompt, grade):
        self.name, self.seed, self.prompt, self.grade = name, seed, prompt, grade


def bench_tickets(tasks_dir):
    out = []
    for t in sorted(os.listdir(tasks_dir)):
        d = os.path.join(tasks_dir, t)

        def seed(work, d=d):
            shutil.copytree(os.path.join(d, "repo"), work, dirs_exist_ok=True)

        def grade(work, d=d):
            shutil.copy(os.path.join(d, "hidden_test.py"), work)
            h = sh("python3 -m unittest hidden_test", work, timeout=180)
            return h.returncode == 0, (h.stdout + h.stderr)[-600:]

        out.append(Ticket(t, seed, PREAMBLE + open(os.path.join(d, "issue.md")).read(), grade))
    return out


def suite_tickets(suite):
    spec = importlib.util.spec_from_file_location("run_suite", os.path.join(suite, "runner", "run_suite.py"))
    rs = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rs)
    out = []
    for t, cfg in rs.CODE_TASKS.items():
        d = os.path.join(suite, "tasks", t)

        def seed(work, d=d, cfg=cfg):
            for s in cfg["seed"] + cfg.get("static", []):
                shutil.copy(os.path.join(d, s), work)

        def grade(work, d=d, cfg=cfg, t=t):
            with tempfile.TemporaryDirectory(prefix="loop-guard-grade-", dir=TMP) as td:
                missing = [f for f in cfg["files"] if not os.path.exists(os.path.join(work, f))]
                if missing:
                    return False, f"missing files: {missing}"
                for f in cfg["files"]:
                    shutil.copy(os.path.join(work, f), td)
                for s in cfg.get("static", []):
                    shutil.copy(os.path.join(d, s), td)
                p = rs.restricted_exec(os.path.join(suite, "validators", cfg["validator"]), td)
                return p.returncode == 0, (p.stdout + p.stderr)[-600:]

        out.append(Ticket(t, seed, PREAMBLE + open(os.path.join(d, cfg["task_md"])).read() + SUITE_NOTE, grade))
    return out


NOTE_RULES = {"retry": "call has now failed", "repeat": "You have run this exact", "streak": "tool calls all failed"}


def session_counts(sess):
    """Notes and nudges loop-guard actually added in this session."""
    c = {f"note_{k}": 0 for k in NOTE_RULES} | {"nudge_stall": 0}
    for f in glob.glob(os.path.join(sess, "*.jsonl")):
        for line in open(f):
            d = json.loads(line)
            m = d.get("message") or {}
            if d.get("type") == "custom_message" and d.get("customType") == "loop-guard":
                c["nudge_stall"] += 1
            if m.get("role") == "toolResult":
                txt = " ".join(x.get("text", "") for x in m.get("content") or [] if isinstance(x, dict))
                if "[loop-guard]" in txt:
                    for k, s in NOTE_RULES.items():
                        c[f"note_{k}"] += s in txt
    return c


def replay(sess):
    p = subprocess.run(["node", os.path.join(HERE, "replay.mjs"), sess, "--json"], capture_output=True, text=True)
    if p.returncode != 0:
        return {}
    d = json.loads(p.stdout)
    merged = {}
    for cls in ("local", "cloud"):
        for k, v in d[cls].items():
            merged[k] = merged.get(k, 0) + v
    return {k: merged.get(k, 0) for k in ("turns", "calls", "errors", "exactRetry", "retry", "repeat", "streak", "finals", "stall")}


def run(args, arm, ticket, rnd):
    name = f"{ticket.name}-r{rnd}"
    work = os.path.join(CACHE, "work", args.label, arm, name)
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    ticket.seed(work)
    sh("git init -q && git add -A && git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm init", work)
    sess = os.path.join(CACHE, "sessions", args.label, arm, name)
    shutil.rmtree(sess, ignore_errors=True)
    os.makedirs(sess)
    env = {k: v for k, v in os.environ.items() if not re.match(r"^(HERDR|ORCA)_", k)}
    env.update(PI_CODING_AGENT_DIR=AGENT, TMPDIR=TMP)
    model = args.model + (f":{args.thinking}" if args.thinking else "")
    cmd = ["pi", "-p", "--mode", "json", "--model", model, "--session-dir", sess]
    if arm == "guard":
        cmd += ["-e", os.path.join(EXT, "index.ts")]
    t0 = time.time()
    try:
        p = subprocess.run(cmd + [ticket.prompt], cwd=work, capture_output=True, text=True, timeout=args.timeout, env=env)
        rc, timed_out = p.returncode, False
        err_tail = p.stderr[-400:]
    except subprocess.TimeoutExpired:
        rc, timed_out, err_tail = None, True, ""
    wall = round(time.time() - t0, 1)
    try:
        passed, tail = ticket.grade(work)
    except Exception as e:  # a grader crash is a failed run, not a crashed benchmark
        passed, tail = False, f"grader error: {e}"
    row = {"label": args.label, "model": args.model, "arm": arm, "task": ticket.name, "round": rnd, "passed": passed,
           "wall_s": wall, "agent_rc": rc, "timed_out": timed_out, **replay(sess), **session_counts(sess),
           "grade_tail": tail[-300:], "stderr_tail": err_tail}
    shutil.rmtree(work, ignore_errors=True)
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--label", default="")
    ap.add_argument("--rounds", type=int, default=1)
    ap.add_argument("--tasks", default="")
    ap.add_argument("--thinking", default="")
    ap.add_argument("--sets", default="bench")
    ap.add_argument("--suite", default="")
    ap.add_argument("--arms", default="base,guard")
    ap.add_argument("--timeout", type=int, default=1200)
    args = ap.parse_args()
    args.label = args.label or re.sub(r"[^A-Za-z0-9.-]+", "_", args.model)
    make_agent_copy()
    tickets = [t for s in args.sets.split(",") if s for t in bench_tickets(TASK_SETS[s])]
    tickets += suite_tickets(args.suite) if args.suite else []
    if args.tasks:
        want = args.tasks.split(",")
        tickets = [t for t in tickets if t.name in want]
    os.makedirs(RESULTS, exist_ok=True)
    out = os.path.join(RESULTS, f"{args.label}.jsonl")
    done = set()
    if os.path.exists(out):
        done = {(r["arm"], r["task"], r["round"]) for r in map(json.loads, open(out))}
    arms = args.arms.split(",")
    # one append per row: the file may be replaced (a checkout or stash) while a run goes on
    for rnd in range(1, args.rounds + 1):
        for i, t in enumerate(tickets):
            # alternate which arm goes first, so neither always gets the warmer cache
            for arm in (arms if (i + rnd) % 2 == 0 else arms[::-1]):
                if (arm, t.name, rnd) in done:
                    continue
                r = run(args, arm, t, rnd)
                with open(out, "a") as f:
                    f.write(json.dumps(r) + "\n")
                print(f"{args.label} {arm:5} {t.name} r{rnd} {'PASS' if r['passed'] else 'FAIL'} {r['wall_s']}s "
                      f"turns={r.get('turns')} calls={r.get('calls')} err={r.get('errors')} exact={r.get('exactRetry')} "
                      f"notes={r['note_retry']}/{r['note_repeat']}/{r['note_streak']} stall={r.get('stall')} "
                      f"nudges={r['nudge_stall']}{' TIMEOUT' if r['timed_out'] else ''}", flush=True)


if __name__ == "__main__":
    main()
