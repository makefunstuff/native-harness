#!/usr/bin/env python3
"""Long-context scenario for the context-editing and compaction experiments: one pi session (RPC
mode) with five prompts that read a lot (a ~60 KB design doc, 13 modules, then the rename with
re-reads), a manual /compact after prompt 4, and a short question after it.

usage: bench/longctx.py ARM --provider llama.cpp|llama-native [--exp prune] [--round N]
Writes results/raw/longctx/<ARM>-r<N>.{json,metrics.jsonl,session/}.
"""
import argparse, json, os, random, shutil, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
RAW = os.path.join(REPO, "results", "raw", "longctx")
RUN = os.path.expanduser("~/.cache/native-harness/run")
WORK = os.path.expanduser("~/.cache/native-harness/work/longctx")

PROMPTS = [
    "Read docs/design.md completely with the read tool (continue with offset when it is truncated). "
    "Then list the numbered design rules that mention rounding, one line each.",
    "Read every module in shop/ one by one with the read tool (do not use bash or codemode to read them) "
    "and make a table: module, TAX constant, number of *_case_* functions.",
    "Now make the change described in issue.md. Re-read any file you edited to check it.",
    "Run the tests, and check with grep that no module except shop/money.py still mentions calc_total. "
    "Report the result in two lines.",
    "COMPACT",
    "In one paragraph: what did we change in this session, and which design rules did it touch?",
]


def make_design_doc(path):
    rnd = random.Random(11)
    words = ("order total tax rate rounding cent decimal invoice refund coupon shipping currency ledger audit "
             "export module boundary deprecation keyword caller migration report subscription wholesale").split()
    out = ["# Shop design notes\n"]
    rule = 1
    for sec in range(1, 13):
        out.append(f"\n## Section {sec}\n")
        for _ in range(9):
            sent = " ".join(rnd.choice(words) for _ in range(rnd.randint(12, 22)))
            if rnd.random() < 0.35:
                out.append(f"\nRule {rule}. {sent.capitalize()}.\n")
                rule += 1
            else:
                out.append(sent.capitalize() + ". " + " ".join(rnd.choice(words) for _ in range(rnd.randint(30, 60))) + ".\n")
    open(path, "w").write("".join(out))


class Rpc:
    def __init__(self, cmd, cwd, env):
        self.p = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=open(os.path.join(RUN, "longctx.stderr"), "ab"))
        self.buf = b""
        self.events = []
        self.lock = threading.Condition()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        while True:
            chunk = self.p.stdout.read1(65536)
            if not chunk:
                with self.lock:
                    self.events.append({"type": "_eof"})
                    self.lock.notify_all()
                return
            self.buf += chunk
            while b"\n" in self.buf:
                line, self.buf = self.buf.split(b"\n", 1)
                line = line.rstrip(b"\r")
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except Exception:
                    continue
                with self.lock:
                    self.events.append(ev)
                    self.lock.notify_all()

    def send(self, obj):
        self.p.stdin.write((json.dumps(obj) + "\n").encode())
        self.p.stdin.flush()

    def wait(self, pred, timeout):
        end = time.time() + timeout
        with self.lock:
            i = 0
            while True:
                while i < len(self.events):
                    ev = self.events[i]
                    i += 1
                    if pred(ev) or ev.get("type") == "_eof":
                        del self.events[:i]
                        return ev
                left = end - time.time()
                if left <= 0:
                    return None
                self.lock.wait(left)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("arm")
    ap.add_argument("--provider", required=True)
    ap.add_argument("--exp", default="")
    ap.add_argument("--round", type=int, default=1)
    ap.add_argument("--thinking", default="medium")
    a = ap.parse_args()
    name = f"{a.arm}-r{a.round}"
    os.makedirs(RAW, exist_ok=True)
    work = os.path.join(WORK, name)
    shutil.rmtree(work, ignore_errors=True)
    shutil.copytree(os.path.join(HERE, "tasks", "bulk-rename", "repo"), work)
    shutil.copy(os.path.join(HERE, "tasks", "bulk-rename", "issue.md"), work)
    os.makedirs(os.path.join(work, "docs"))
    make_design_doc(os.path.join(work, "docs", "design.md"))
    subprocess.run("git init -q && git add -A && git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm init",
                   cwd=work, shell=True)
    metrics = os.path.join(RAW, name + ".metrics.jsonl")
    if os.path.exists(metrics):
        os.remove(metrics)
    for base in ("proxy.jsonl", "native.jsonl"):
        open(os.path.join(RUN, base + ".target"), "w").write(metrics)
    sess = os.path.join(RAW, name + ".session")
    shutil.rmtree(sess, ignore_errors=True)
    os.makedirs(sess)
    env = dict(os.environ, LLAMA_NATIVE_METRICS=os.path.join(RUN, "native.jsonl"), LLAMA_NATIVE_EXP=a.exp)
    model = f"{a.provider}/qwen3.8-27b:{a.thinking}"
    rpc = Rpc([os.path.join(REPO, "scripts", "pi.sh"), "--mode", "rpc", "--model", model, "--session-dir", sess], work, env)
    steps = []
    t_all = time.time()
    for i, pr in enumerate(PROMPTS):
        t0 = time.time()
        if pr == "COMPACT":
            rpc.send({"id": f"c{i}", "type": "compact"})
            ev = rpc.wait(lambda e: e.get("type") == "response" and e.get("id") == f"c{i}", 1800)
            d = (ev or {}).get("data") or {}
            steps.append({"step": i, "kind": "compact", "s": round(time.time() - t0, 2), "ok": bool(ev and ev.get("success")),
                          "tokensBefore": d.get("tokensBefore"), "estimatedTokensAfter": d.get("estimatedTokensAfter"),
                          "usage": d.get("usage"), "summary_chars": len(d.get("summary") or ""),
                          "error": (ev or {}).get("error")})
        else:
            rpc.send({"id": f"p{i}", "type": "prompt", "message": pr})
            ev = rpc.wait(lambda e: e.get("type") == "agent_settled", 1800)
            steps.append({"step": i, "kind": "prompt", "s": round(time.time() - t0, 2), "settled": bool(ev and ev.get("type") == "agent_settled")})
        print(name, steps[-1], flush=True)
    rpc.p.stdin.close()
    try:
        rpc.p.wait(60)
    except subprocess.TimeoutExpired:
        rpc.p.kill()
    shutil.copy(os.path.join(HERE, "tasks", "bulk-rename", "hidden_test.py"), work)
    t = subprocess.run("python3 -m unittest hidden_test", cwd=work, shell=True, capture_output=True, text=True, timeout=180)
    res = {"arm": a.arm, "round": a.round, "provider": a.provider, "exp": a.exp, "total_s": round(time.time() - t_all, 1),
           "hidden_passed": t.returncode == 0, "steps": steps}
    json.dump(res, open(os.path.join(RAW, name + ".json"), "w"), indent=1)
    shutil.rmtree(work, ignore_errors=True)
    print("DONE", json.dumps({k: v for k, v in res.items() if k != "steps"}))


if __name__ == "__main__":
    main()
