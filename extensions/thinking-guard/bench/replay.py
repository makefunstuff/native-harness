#!/usr/bin/env python3
"""Replay captured pi requests (bench/capture.mjs) on a llama.cpp server, as sent ("off") and with
thinking-guard's budget added ("on": thinking_budget_tokens + reasoning_budget_message, the same
fields the extension adds), and record how long the reply thinks and whether it ends in a tool call.

usage: replay.py BASE_URL OUT.jsonl PAYLOAD.json [...] [--arms off,on] [--rounds N]
BASE_URL is the server root, e.g. http://my-gpu-box:8080 (not stored anywhere).
"""
import argparse, json, os, time, urllib.request

BUDGET_TOKENS = 3000
BUDGET_MESSAGE = ("\n\nI have deliberated long enough. I stop thinking now and act: my next step is a tool call "
                  "that checks or changes something, or the answer.\n")


def replay(base, payload, arm):
    body = dict(payload, stream=True)
    if arm == "on":
        body["thinking_budget_tokens"] = BUDGET_TOKENS
        body["reasoning_budget_message"] = BUDGET_MESSAGE
    req = urllib.request.Request(base.rstrip("/") + "/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json"})
    t0 = time.time()
    reasoning, content, tools, finish, timings = "", "", {}, None, None
    with urllib.request.urlopen(req, timeout=7200) as resp:
        for line in resp:
            line = line.decode().strip()
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            d = json.loads(line[6:])
            timings = d.get("timings") or timings
            for ch in d.get("choices") or []:
                delta = ch.get("delta") or {}
                reasoning += delta.get("reasoning_content") or ""
                content += delta.get("content") or ""
                for tc in delta.get("tool_calls") or []:
                    tools.setdefault(tc.get("index", 0), (tc.get("function") or {}).get("name"))
                    if (tc.get("function") or {}).get("name"):
                        tools[tc.get("index", 0)] = tc["function"]["name"]
                finish = ch.get("finish_reason") or finish
    return {"arm": arm, "wall_s": round(time.time() - t0, 1), "reasoning_chars": len(reasoning), "content_chars": len(content),
            "tool_calls": [n for n in tools.values() if n], "finish": finish,
            "budget_hit": BUDGET_MESSAGE.strip() in reasoning,
            "predicted_n": (timings or {}).get("predicted_n"), "prompt_n": (timings or {}).get("prompt_n"),
            "cache_n": (timings or {}).get("cache_n"), "reasoning_tail": reasoning[-200:], "content_head": content[:200]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("out")
    ap.add_argument("payloads", nargs="+")
    ap.add_argument("--arms", default="off,on")
    ap.add_argument("--rounds", type=int, default=1)
    a = ap.parse_args()
    with open(a.out, "a") as f:
        for rnd in range(1, a.rounds + 1):
            for p in a.payloads:
                payload = json.load(open(p))
                for arm in a.arms.split(","):
                    r = {"case": os.path.basename(p)[:-5], "round": rnd, **replay(a.base, payload, arm)}
                    f.write(json.dumps(r) + "\n")
                    f.flush()
                    print(f"{r['case']} r{rnd} {arm}: thinking {r['reasoning_chars']} chars, tools {r['tool_calls']}, "
                          f"finish {r['finish']}, {r['wall_s']}s, budget_hit={r['budget_hit']}", flush=True)


if __name__ == "__main__":
    main()
