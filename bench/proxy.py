#!/usr/bin/env python3
"""Pass-through HTTP proxy between pi and llama-server that records, per chat request, the time to
first token seen by the client, the total time, and llama-server's own `timings` (prompt_n, cache_n,
predicted_n, draft stats). Streams the response unchanged.

usage: proxy.py LISTEN_PORT UPSTREAM_PORT LOG_JSONL [PAYLOAD_DIR]
The log file can be switched per task by writing a path into LOG_JSONL + ".target".
"""
import http.client, http.server, json, os, sys, threading, time

LISTEN, UP, LOG = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
PAYLOAD_DIR = sys.argv[4] if len(sys.argv) > 4 else None
lock = threading.Lock()


def log_path():
    try:
        t = open(LOG + ".target").read().strip()
        return t or LOG
    except OSError:
        return LOG


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _forward(self, method):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else None
        t0 = time.time()
        req = None
        if body and self.path.endswith("/chat/completions"):
            try:
                req = json.loads(body)
            except Exception:
                req = None
            if PAYLOAD_DIR and req is not None:
                os.makedirs(PAYLOAD_DIR, exist_ok=True)
                with open(os.path.join(PAYLOAD_DIR, f"{int(t0 * 1000)}.json"), "w") as f:
                    json.dump(req, f)
        c = http.client.HTTPConnection("127.0.0.1", UP, timeout=7200)
        hdr = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "connection", "accept-encoding")}
        c.request(method, self.path, body=body, headers=hdr)
        r = c.getresponse()
        self.send_response(r.status)
        for k, v in r.getheaders():
            if k.lower() in ("transfer-encoding", "connection", "content-length"):
                continue
            self.send_header(k, v)
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Connection", "close")
        self.end_headers()
        ttft = None
        last = None
        buf = b""
        while True:
            chunk = r.read1(65536) if hasattr(r, "read1") else r.read(65536)
            if not chunk:
                break
            if req is not None:
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if line.startswith(b"data: ") and line[6:].strip() != b"[DONE]":
                        try:
                            d = json.loads(line[6:])
                        except Exception:
                            continue
                        ch = (d.get("choices") or [{}])[0].get("delta") or {}
                        if ttft is None and (ch.get("content") or ch.get("reasoning_content") or ch.get("tool_calls")):
                            ttft = time.time() - t0
                        if "timings" in d:
                            last = d
            self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
            self.wfile.flush()
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()
        if req is not None:
            rec = {"t": t0, "total_ms": (time.time() - t0) * 1000, "ttft_ms": ttft * 1000 if ttft else None,
                   "status": r.status, "n_messages": len(req.get("messages", [])),
                   "timings": (last or {}).get("timings"), "usage": (last or {}).get("usage")}
            with lock, open(log_path(), "a") as f:
                f.write(json.dumps(rec) + "\n")

    def do_GET(self):
        self._forward("GET")

    def do_POST(self):
        self._forward("POST")


http.server.ThreadingHTTPServer(("127.0.0.1", LISTEN), H).serve_forever()
