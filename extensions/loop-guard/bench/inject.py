#!/usr/bin/env python3
"""Injection experiment: make the situation loop-guard is for happen, then let the real model go on.

The bench tickets rarely make a model retry blindly, so a plain before/after run says little about
what the guard does when it fires. Here pi talks to a local proxy that plays a scripted opening
for the first requests (a tool call that fails, sent twice unchanged; or an answer that stops on
"Let me …" with no tool call) and forwards every later request to the real model. pi runs the
scripted calls for real, so the failures are real tool results, and in the "guard" arm loop-guard
adds its note (or nudge) exactly as it would in a live session. Then the model takes over.

usage: bench/inject.py --provider llama.cpp --model qwen3.8-27b [--thinking medium] [--rounds N]
                       [--scenarios a,b] [--label NAME]

Per run: whether the model's first own tool call repeats the injected call a third time, how many
more identical failures follow, whether the run went on at all after a stall, and the hidden-test
result. Rows go to bench/results/<label>.jsonl.
"""
import argparse, json, os, re, shutil, subprocess, sys, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run as bench  # noqa: E402  (agent copy, tickets, session counts)

EDIT_OLD = '        "timeout": 60,\n        "retries": 3,'
EDIT_NEW = '        "timeout": 120,\n        "retries": 5,'

# scenario -> (ticket set, ticket, scripted responses for the first requests)
SCENARIOS = {
    # the issue names a path that does not exist
    "retry-read": ("traps", "stale-paths", [{"tool": ("read", {"path": "src/billing/invoice.py"})}] * 2),
    # the test script has no exec bit
    "retry-bash": ("traps", "no-exec", [{"tool": ("bash", {"command": "./run_tests.sh"})}] * 2),
    # the replaced text appears twice in the file
    "retry-edit": ("traps", "twin-blocks", [{"tool": ("edit", {"path": "deploy/envs.py", "edits": [{"oldText": EDIT_OLD, "newText": EDIT_NEW}]})}] * 2),
    # one real look around, then an answer that announces the work and stops
    "stall": ("bench", "logstats", [{"tool": ("bash", {"command": "ls -R"})}, {"text": "The parser is in logstats/parser.py. Let me read it and fix both bugs."}]),
}


def sse(n, step):
    base = {"id": f"chatcmpl-inject-{n}", "object": "chat.completion.chunk", "created": int(time.time()), "model": "inject"}
    out = []
    send = lambda delta, finish=None, extra={}: out.append(
        "data: " + json.dumps({**base, "choices": [{"index": 0, "delta": delta, "finish_reason": finish}], **extra}) + "\n\n")
    send({"role": "assistant"})
    # a short reasoning text, as a thinking model writes one (some APIs require it on every turn)
    send({"reasoning_content": step.get("thinking", "Following the issue, this is the next step.")})
    if "text" in step:
        send({"content": step["text"]})
    if "tool" in step:
        name, args = step["tool"]
        send({"tool_calls": [{"index": 0, "id": f"call_inject_{n}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]})
    send({}, "tool_calls" if "tool" in step else "stop", {"usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})
    out.append("data: [DONE]\n\n")
    return "".join(out).encode()


class Proxy:
    """Scripted answers for the first len(script) requests, the real upstream after that."""

    def __init__(self, upstream):
        self.upstream, self.script, self.n = upstream.rstrip("/"), [], 0
        proxy = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                self.send_response(404)
                self.end_headers()

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("content-length", 0)))
                n, proxy.n = proxy.n, proxy.n + 1
                if os.environ.get("INJECT_DEBUG"):
                    print(f"proxy: request {n} ({'scripted' if n < len(proxy.script) else 'forwarded'})", file=sys.stderr, flush=True)
                if n < len(proxy.script):
                    data = sse(n, proxy.script[n])
                    self.send_response(200)
                    self.send_header("content-type", "text/event-stream")
                    self.send_header("content-length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                hdrs = {k: v for k, v in self.headers.items() if k.lower() in ("authorization", "content-type", "accept", "user-agent") or k.lower().startswith("x-")}
                # pi posts to <baseUrl>/chat/completions; the proxy's base URL has no path
                req = urllib.request.Request(proxy.upstream + self.path, data=body, headers=hdrs, method="POST")
                try:
                    r = urllib.request.urlopen(req, timeout=1800)
                except urllib.error.HTTPError as e:
                    r = e
                self.send_response(r.status if hasattr(r, "status") else r.code)
                for k, v in r.headers.items():
                    if k.lower() in ("content-type",):
                        self.send_header(k, v)
                self.send_header("connection", "close")
                self.end_headers()
                while True:
                    chunk = r.read1(65536) if hasattr(r, "read1") else r.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def reset(self, script):
        self.script, self.n = script, 0


def add_inject_provider(provider, proxy_url):
    """In the agent copy: provider "inject" = the given provider with its base URL on the proxy."""
    p = os.path.join(bench.AGENT, "models.json")
    models = json.load(open(p))
    src = models["providers"][provider]
    # pi infers some request details from a provider's URL; behind the proxy it cannot, so the
    # system message role is set explicitly (models that already declare it keep their value)
    inject_models = [{**m, "compat": {"supportsDeveloperRole": False, **({"reasoningContentField": "reasoning_content"} if m.get("reasoning") else {}), **(m.get("compat") or {})}} for m in src.get("models", [])]
    models["providers"]["inject"] = {**src, "baseUrl": proxy_url, "models": inject_models}
    json.dump(models, open(p, "w"), indent=2)
    auth_p = os.path.join(bench.AGENT, "auth.json")
    if os.path.exists(auth_p):
        auth = json.load(open(auth_p))
        if provider in auth:
            auth["inject"] = auth[provider]
            json.dump(auth, open(auth_p, "w"), indent=2)
    return src["baseUrl"]


def session_messages(sess):
    import glob
    out = []
    for f in glob.glob(os.path.join(sess, "*.jsonl")):
        for line in open(f):
            d = json.loads(line)
            if d.get("type") == "message" and d.get("message", {}).get("role") in ("assistant", "toolResult"):
                out.append(d["message"])
    return out


def analyse(sess, script):
    """What the model did after the scripted opening."""
    msgs = session_messages(sess)
    assistants = [m for m in msgs if m["role"] == "assistant"]
    own = assistants[len(script):]  # the model's own messages
    inj = script[-1].get("tool")
    calls = [(c["name"], c.get("arguments")) for m in own for c in m.get("content") or [] if c.get("type") == "toolCall"]
    same = lambda c: inj and c[0] == inj[0] and json.dumps(c[1], sort_keys=True) == json.dumps(inj[1], sort_keys=True)
    return {
        "model_turns": len(own),
        "model_calls": len(calls),
        "first_call_repeats": bool(calls and same(calls[0])),
        "repeats_total": sum(1 for c in calls if same(c)),
        "acted_after_stall": bool(calls) if not inj else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--thinking", default="")
    ap.add_argument("--rounds", type=int, default=1)
    ap.add_argument("--scenarios", default=",".join(SCENARIOS))
    ap.add_argument("--label", default="")
    ap.add_argument("--timeout", type=int, default=1200)
    args = ap.parse_args()
    args.label = args.label or "inject-" + re.sub(r"[^A-Za-z0-9.-]+", "_", args.model)
    bench.AGENT = f"{bench.AGENT}-{args.label}"  # its own copy: run.py and other labels refresh theirs
    bench.make_agent_copy()
    proxy = Proxy("http://unset")
    proxy.upstream = add_inject_provider(args.provider, proxy.url).rstrip("/")
    tickets = {t.name: t for s in ("bench", "traps") for t in bench.bench_tickets(bench.TASK_SETS[s])}
    out = os.path.join(bench.RESULTS, f"{args.label}.jsonl")
    done = set()
    if os.path.exists(out):
        done = {(r["arm"], r["scenario"], r["round"]) for r in map(json.loads, open(out)) if not r.get("provider_error")}
    run_args = argparse.Namespace(label=args.label, model=f"inject/{args.model}", thinking=args.thinking, timeout=args.timeout)
    # one append per row: the file may be replaced (a checkout or stash) while a run goes on
    for rnd in range(1, args.rounds + 1):
        for i, sc in enumerate(args.scenarios.split(",")):
            _, ticket, script = SCENARIOS[sc]
            for arm in (("base", "guard") if (i + rnd) % 2 == 0 else ("guard", "base")):
                if (arm, sc, rnd) in done:
                    continue
                proxy.reset(script)
                t = tickets[ticket]
                named = bench.Ticket(f"{sc}", t.seed, t.prompt, t.grade)
                row = bench.run(run_args, arm, named, rnd)
                row.update(scenario=sc, task=ticket, model=f"{args.provider}/{args.model}",
                           **analyse(os.path.join(bench.CACHE, "sessions", args.label, arm, f"{sc}-r{rnd}"), script))
                with open(out, "a") as f:
                    f.write(json.dumps(row) + "\n")
                print(f"{args.label} {arm:5} {sc:10} r{rnd} {'PASS' if row['passed'] else 'FAIL'} {row['wall_s']}s "
                      f"first_repeat={row['first_call_repeats']} repeats={row['repeats_total']} model_turns={row['model_turns']} "
                      f"notes={row['note_retry']}/{row['note_repeat']}/{row['note_streak']} nudges={row['nudge_stall']}"
                      f"{' TIMEOUT' if row['timed_out'] else ''}", flush=True)


if __name__ == "__main__":
    main()
