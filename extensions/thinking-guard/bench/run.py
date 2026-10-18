#!/usr/bin/env python3
"""thinking-guard benchmark: the human's pi (same install, a copy of the same config) works coding
tickets headless, with or without the extension; hidden tests grade the final tree.

usage: run.py ARM --model PROVIDER/ID [--guard on|off] [--scope local|all] [--rounds N]
              [--tasks bench/cli-json,trap/pcap-decode,...] [--suite DIR]
       run.py --report [ARM ...]

Tickets:
  bench/<t>  experimental/llama-native/bench/tasks (issue.md, repo/, hidden_test.py)
  trap/<t>   bench/tasks here: tickets that invite working things out in one's head
  suite/<t>  a capability suite given with --suite DIR (tasks/<t>/task.md, an optional
             fixture_*/ dir, validators/<t>_test.py <dir>), e.g. the homelab evals' suite

Each arm gets its own copy of ~/.pi/agent (no sessions) in ~/.cache/pi-extras/thinking-guard.
Models on a private network are reached through a logging proxy that records llama-server's
timings per request (prompt tokens processed and reused, tokens generated), so prompt-cache reuse
after a guard abort can be checked. --guard on loads extensions/thinking-guard with -e.

Writes one row per run to results/<ARM>.jsonl (resumable: finished task/round pairs are skipped).
pi sessions stay in ~/.cache/pi-extras/thinking-guard/sessions, outside the repo.
"""
import argparse, glob, http.client, http.server, ipaddress, json, os, shutil, socket, statistics, subprocess, sys, threading, time
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
EXTENSION = os.path.join(REPO, "extensions", "thinking-guard", "index.ts")
SOURCES = {"bench": os.path.join(REPO, "experimental", "llama-native", "bench", "tasks"), "trap": os.path.join(HERE, "tasks")}
RESULTS = os.path.join(HERE, "results")
CACHE = os.path.expanduser("~/.cache/pi-extras/thinking-guard")
TIMEOUT = 1800
LONG = 8000  # a "long" thinking turn, in characters
PREAMBLE = ("You are working autonomously in this repository; nobody will answer questions. "
            "Read the code, make the change, run the tests, and stop when the work is done.\n\n")


def sh(cmd, cwd, timeout=180):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout)


# ---------------------------------------------------------------------------- logging proxy

class Proxy:
    """Pass-through proxy to an OpenAI-compatible server; records one line per chat request.
    Paths are forwarded unchanged, so a base URL is moved behind it with reroute()."""

    def __init__(self, upstream):
        u = urlsplit(upstream)
        self.scheme, self.host, self.port = u.scheme, u.hostname, u.port or (443 if u.scheme == "https" else 80)
        self.upstream = f"{u.scheme}://{u.netloc}"
        self.log = None
        self.lock = threading.Lock()
        proxy = self

        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def do_GET(self):
                proxy.forward(self, "GET")

            def do_POST(self):
                proxy.forward(self, "POST")

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.origin = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def reroute(self, url):
        return self.origin + url[len(self.upstream):] if url.startswith(self.upstream) else url

    def forward(self, h, method):
        if "chunked" in (h.headers.get("Transfer-Encoding") or "").lower():
            body = b""  # undici streams request bodies
            while True:
                size = int(h.rfile.readline().split(b";")[0].strip() or b"0", 16)
                if size == 0:
                    h.rfile.readline()
                    break
                body += h.rfile.read(size)
                h.rfile.readline()
        else:
            n = int(h.headers.get("Content-Length") or 0)
            body = h.rfile.read(n) if n else None
        req = None
        if body and h.path.endswith("/chat/completions"):
            try:
                req = json.loads(body)
            except ValueError:
                pass
        t0 = time.time()
        conn_cls = http.client.HTTPSConnection if self.scheme == "https" else http.client.HTTPConnection
        c = conn_cls(self.host, self.port, timeout=7200)
        hdr = {k: v for k, v in h.headers.items() if k.lower() not in ("host", "connection", "accept-encoding", "transfer-encoding", "content-length")}
        rec = {"t": round(t0, 3), "n_messages": len((req or {}).get("messages", [])),
               "budget": (req or {}).get("thinking_budget_tokens"), "reasoning_chars": 0, "content_chars": 0,
               "client_gone": False, "timings": None}
        try:
            c.request(method, h.path, body=body, headers=hdr)
            r = c.getresponse()
            h.send_response(r.status)
            for k, v in r.getheaders():
                if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                    h.send_header(k, v)
            h.send_header("Transfer-Encoding", "chunked")
            h.send_header("Connection", "close")
            h.end_headers()
            buf = b""
            while True:
                chunk = r.read1(65536)
                if not chunk:
                    break
                if req is not None:
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        if line.startswith(b"data: ") and line[6:].strip() != b"[DONE]":
                            try:
                                d = json.loads(line[6:])
                            except ValueError:
                                continue
                            delta = (d.get("choices") or [{}])[0].get("delta") or {}
                            rec["reasoning_chars"] += len(delta.get("reasoning_content") or "")
                            rec["content_chars"] += len(delta.get("content") or "")
                            if d.get("timings"):
                                rec["timings"] = {k: d["timings"].get(k) for k in ("prompt_n", "cache_n", "predicted_n", "prompt_ms", "predicted_ms")}
                try:
                    h.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
                    h.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    rec["client_gone"] = True  # pi aborted the request
                    break
            if not rec["client_gone"]:
                h.wfile.write(b"0\r\n\r\n")
                h.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            rec["client_gone"] = True
        finally:
            c.close()
        if req is not None and self.log:
            rec["total_ms"] = round((time.time() - t0) * 1000)
            with self.lock, open(self.log, "a") as f:
                f.write(json.dumps(rec) + "\n")


def is_private(url):
    host = urlsplit(url).hostname or ""
    try:
        return ipaddress.ip_address(host).is_private
    except ValueError:
        return host == "localhost" or "." not in host or host.endswith((".local", ".lan", ".internal"))


# ---------------------------------------------------------------------------- agent config copy

def agent_dir(arm, provider):
    """A copy of ~/.pi/agent for this arm; a private-network provider is pointed at a proxy."""
    src = os.path.expanduser(os.environ.get("PI_THINKING_GUARD_BENCH_SOURCE", "~/.pi/agent"))
    dst = os.path.join(CACHE, "agent", arm)
    shutil.rmtree(dst, ignore_errors=True)
    ignore = lambda d, names: [n for n in names if n == "sessions" and d == src or n.endswith("~") or ".pre-" in n or ".bak" in n]
    shutil.copytree(src, dst, symlinks=True, ignore=ignore)
    os.makedirs(os.path.join(dst, "sessions"), exist_ok=True)
    settings_path = os.path.join(dst, "settings.json")
    settings = json.load(open(settings_path)) if os.path.exists(settings_path) else {}
    this = lambda p: "pi-extras" in (p if isinstance(p, str) else p.get("source", ""))
    settings["packages"] = [p for p in settings.get("packages", []) if not this(p)]
    settings["extensions"] = [p for p in settings.get("extensions", []) if "thinking-guard" not in p]
    json.dump(settings, open(settings_path, "w"), indent=2)
    # models.json and pi's model store (models-store.json, which keeps the resolved base URLs)
    proxy = None
    models_path, store_path = os.path.join(dst, "models.json"), os.path.join(dst, "models-store.json")
    models = json.load(open(models_path)) if os.path.exists(models_path) else {}
    store = json.load(open(store_path)) if os.path.exists(store_path) else {}
    prov = models.get("providers", {}).get(provider) or {}
    stored = (store.get(provider) or {}).get("models", [])
    base = prov.get("baseUrl") or next((m.get("baseUrl") for m in stored if m.get("baseUrl")), None)
    if base and is_private(base):
        proxy = Proxy(base)
        if prov.get("baseUrl"):
            prov["baseUrl"] = proxy.reroute(prov["baseUrl"])
        for m in stored:
            if m.get("baseUrl"):
                m["baseUrl"] = proxy.reroute(m["baseUrl"])
        json.dump(models, open(models_path, "w"), indent=2)
        if store:
            json.dump(store, open(store_path, "w"), indent=2)
        # auth.json may set the base URL too, through the provider's env (e.g. LLAMA_BASE_URL)
        auth_path = os.path.join(dst, "auth.json")
        auth = json.load(open(auth_path)) if os.path.exists(auth_path) else {}
        env = (auth.get(provider) or {}).get("env")
        if isinstance(env, dict):
            for k, v in env.items():
                if isinstance(v, str):
                    env[k] = proxy.reroute(v)
            with open(os.open(auth_path, os.O_WRONLY | os.O_TRUNC | os.O_CREAT, 0o600), "w") as f:
                json.dump(auth, f, indent=2)
    return dst, proxy


# ---------------------------------------------------------------------------- tickets

def tickets(suite):
    out = {}
    for kind, root in SOURCES.items():
        if os.path.isdir(root):
            for t in sorted(os.listdir(root)):
                if os.path.exists(os.path.join(root, t, "issue.md")):
                    out[f"{kind}/{t}"] = ("issue", os.path.join(root, t))
    if suite:
        for t in sorted(os.listdir(os.path.join(suite, "tasks"))):
            if os.path.exists(os.path.join(suite, "validators", f"{t}_test.py")):
                out[f"suite/{t}"] = ("suite", os.path.join(suite, "tasks", t))
    return out


def prepare(kind, tdir, work):
    if kind == "issue":
        shutil.copytree(os.path.join(tdir, "repo"), work, dirs_exist_ok=True)
        return PREAMBLE + open(os.path.join(tdir, "issue.md")).read()
    for fx in glob.glob(os.path.join(tdir, "fixture_*")):
        shutil.copytree(fx, work, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "validator-result.json"))
    return PREAMBLE + open(os.path.join(tdir, "task.md")).read() + "\n\nWrite your files in the current directory."


def grade(kind, tdir, work, suite):
    try:
        if kind == "issue":
            shutil.copy(os.path.join(tdir, "hidden_test.py"), work)
            h = sh("python3 -m unittest hidden_test", work, timeout=300)
        else:
            name = os.path.basename(tdir)
            scratch = os.path.join(CACHE, "grade")
            os.makedirs(scratch, exist_ok=True)
            h = sh(f"python3 {os.path.join(suite, 'validators', name + '_test.py')} {work}", scratch, timeout=300)
        return h.returncode == 0, (h.stdout + h.stderr)[-600:]
    except subprocess.TimeoutExpired:
        return False, "hidden tests timed out"


# ---------------------------------------------------------------------------- stats

def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else 0


def session_stats(sess):
    st = {"assistant_turns": 0, "thinking": [], "aborted_turns": 0, "guard": [], "notes": 0, "tool_calls": 0,
          "tool_errors": 0, "edit_errors": 0, "output_tokens": 0, "stop": None, "provider_errors": 0, "error": None}
    for f in glob.glob(os.path.join(sess, "*.jsonl")):
        for line in open(f):
            d = json.loads(line)
            if d.get("type") == "custom" and d.get("customType") == "thinking-guard":
                st["guard"].append(d.get("data") or {})
            m = d.get("message") or {}
            if m.get("role") == "custom" and m.get("customType") == "thinking-guard":
                st["notes"] += 1
            if m.get("role") == "assistant":
                st["assistant_turns"] += 1
                st["thinking"].append(sum(len(c.get("thinking", "")) for c in m.get("content") or [] if c.get("type") == "thinking"))
                st["output_tokens"] += (m.get("usage") or {}).get("output", 0)
                st["aborted_turns"] += m.get("stopReason") == "aborted"
                st["tool_calls"] += sum(c.get("type") == "toolCall" for c in m.get("content") or [])
                st["stop"] = m.get("stopReason")
                if m.get("stopReason") == "error":
                    st["provider_errors"] += 1
                    st["error"] = (m.get("errorMessage") or "")[:200]
            elif m.get("role") == "toolResult" and m.get("isError"):
                st["tool_errors"] += 1
                st["edit_errors"] += m.get("toolName") == "edit"
    return st


def proxy_stats(path):
    s = {"requests": 0, "prompt_processed": 0, "prompt_reused": 0, "generated": 0, "budget_requests": 0,
         "aborted_requests": 0, "reissue_processed": [], "reissue_reused": []}
    if not os.path.exists(path):
        return s
    after_abort = False
    for line in open(path):
        r = json.loads(line)
        s["requests"] += 1
        s["budget_requests"] += r.get("budget") is not None
        t = r.get("timings") or {}
        s["prompt_processed"] += t.get("prompt_n") or 0
        s["prompt_reused"] += t.get("cache_n") or 0
        s["generated"] += t.get("predicted_n") or 0
        if after_abort and t:
            s["reissue_processed"].append(t.get("prompt_n"))
            s["reissue_reused"].append(t.get("cache_n"))
        after_abort = r.get("client_gone")
        s["aborted_requests"] += bool(r.get("client_gone"))
    return s


# ---------------------------------------------------------------------------- run

def run_task(arm, args, name, kind, tdir, rnd, adir, proxy):
    run = f"{name.replace('/', '-')}-r{rnd}"
    work = os.path.join(CACHE, "work", arm, run)
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    prompt = prepare(kind, tdir, work)
    sh("git init -q && git add -A && git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm init", work)
    sess = os.path.join(CACHE, "sessions", arm, run)
    shutil.rmtree(sess, ignore_errors=True)
    os.makedirs(sess)
    metrics = os.path.join(CACHE, "metrics", arm, run + ".jsonl")
    os.makedirs(os.path.dirname(metrics), exist_ok=True)
    if os.path.exists(metrics):
        os.remove(metrics)
    if proxy:
        proxy.log = metrics
    env = {k: v for k, v in os.environ.items() if not k.startswith(("HERDR_", "ORCA_"))}
    env["PI_CODING_AGENT_DIR"] = adir
    env["TMPDIR"] = os.path.join(CACHE, "tmp")
    os.makedirs(env["TMPDIR"], exist_ok=True)
    env["PI_THINKING_GUARD_CONFIG"] = os.path.join(adir, "thinking-guard.json")  # defaults unless the arm writes one
    if args.scope:
        env["PI_THINKING_GUARD_SCOPE"] = args.scope
    for kv in args.set:
        k, v = kv.split("=", 1)
        env[f"PI_THINKING_GUARD_{k.upper()}"] = v
    cmd = [os.environ.get("PI_BIN", "pi"), "-p", "--mode", "json", "--no-mcp", "--model", args.model, "--session-dir", sess]
    if args.guard == "on":
        cmd += ["-e", EXTENSION]
    t0 = time.time()
    try:
        p = subprocess.run(cmd + [prompt], cwd=work, capture_output=True, text=True, timeout=args.timeout, env=env)
        rc, timed_out = p.returncode, False
    except subprocess.TimeoutExpired:
        rc, timed_out = None, True
    wall = round(time.time() - t0, 1)
    passed, tail = grade(kind, tdir, work, args.suite)
    st, ps = session_stats(sess), proxy_stats(metrics)
    th = st.pop("thinking")
    row = {"arm": arm, "model": args.model, "guard": args.guard, "scope": args.scope or "local", "task": name, "round": rnd,
           "passed": passed, "wall_s": wall, "rc": rc, "timed_out": timed_out,
           "thinking_chars": th, "thinking_max": max(th, default=0), "thinking_p50": pct(th, 0.5), "thinking_p90": pct(th, 0.9),
           "long_turns": sum(x > LONG for x in th), **st,
           "guard_aborts": sum(g.get("kind") == "abort" for g in st["guard"]),
           "budget_hits": sum(g.get("kind") == "budget" for g in st["guard"]), **ps, "hidden_tail": tail[-300:]}
    shutil.rmtree(work, ignore_errors=True)
    return row


def report(arms):
    rows = []
    for f in sorted(glob.glob(os.path.join(RESULTS, "*.jsonl"))):
        if not arms or os.path.basename(f)[:-6] in arms:
            rows += [json.loads(l) for l in open(f)]
    by = {}
    for r in rows:
        by.setdefault(r["arm"], []).append(r)
    print("| arm | model | runs | passed | wall (median) | turns | thinking chars/turn p50 / p90 / max | turns >8k | aborted turns | guard aborts | budget stops | tool errors | output tokens |")
    print("|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|")
    for arm, rs in by.items():
        th = [x for r in rs for x in r["thinking_chars"]]
        print(f"| {arm} | {rs[0]['model']} | {len(rs)} | {sum(r['passed'] for r in rs)} | {statistics.median(r['wall_s'] for r in rs):.0f} s | "
              f"{sum(r['assistant_turns'] for r in rs)} | {pct(th, .5)} / {pct(th, .9)} / {max(th, default=0)} | "
              f"{sum(r['long_turns'] for r in rs)} | {sum(r['aborted_turns'] for r in rs)} | {sum(r['guard_aborts'] for r in rs)} | "
              f"{sum(r['budget_hits'] for r in rs)} | {sum(r['tool_errors'] for r in rs)} | {sum(r['output_tokens'] for r in rs)} |")
    print()
    tasks = sorted({r["task"] for r in rows})
    print("| task | " + " | ".join(by) + " |")
    print("|---|" + "---|" * len(by))
    for t in tasks:
        cells = []
        for arm, rs in by.items():
            x = [r for r in rs if r["task"] == t]
            cells.append(" ".join(f"{'✓' if r['passed'] else '✗'} {r['wall_s']:.0f}s/{r['thinking_max'] // 1000}k" for r in x) or "-")
        print(f"| {t} | " + " | ".join(cells) + " |")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("arm", nargs="*")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--model")
    ap.add_argument("--guard", choices=["on", "off"], default="off")
    ap.add_argument("--scope", choices=["local", "all"])
    ap.add_argument("--set", action="append", default=[], help="KEY=VALUE for PI_THINKING_GUARD_KEY (e.g. budget=off)")
    ap.add_argument("--rounds", type=int, default=1)
    ap.add_argument("--first-round", type=int, default=1)
    ap.add_argument("--tasks", default="")
    ap.add_argument("--suite", default=os.environ.get("PI_THINKING_GUARD_SUITE"))
    ap.add_argument("--timeout", type=int, default=TIMEOUT)
    args = ap.parse_args()
    if args.report:
        return report(args.arm)
    if len(args.arm) != 1 or not args.model:
        ap.error("one ARM and --model are required")
    arm = args.arm[0]
    all_tickets = tickets(args.suite)
    names = args.tasks.split(",") if args.tasks else list(all_tickets)
    adir, proxy = agent_dir(arm, args.model.split("/", 1)[0])
    os.makedirs(RESULTS, exist_ok=True)
    out = os.path.join(RESULTS, f"{arm}.jsonl")
    done = {(json.loads(l)["task"], json.loads(l)["round"]) for l in open(out)} if os.path.exists(out) else set()
    with open(out, "a") as f:
        for rnd in range(args.first_round, args.first_round + args.rounds):
            for name in names:
                if (name, rnd) in done:
                    continue
                kind, tdir = all_tickets[name]
                r = run_task(arm, args, name, kind, tdir, rnd, adir, proxy)
                f.write(json.dumps(r) + "\n")
                f.flush()
                print(f"{arm} {name} r{rnd} {'PASS' if r['passed'] else 'FAIL'} {r['wall_s']}s turns={r['assistant_turns']} "
                      f"think max={r['thinking_max']} long={r['long_turns']} aborts={r['guard_aborts']} budget={r['budget_hits']} "
                      f"req={r['requests']} reuse={r['prompt_reused']}/{r['prompt_reused'] + r['prompt_processed']}"
                      f"{' TIMEOUT' if r['timed_out'] else ''}", flush=True)


if __name__ == "__main__":
    main()
