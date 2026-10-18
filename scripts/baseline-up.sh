#!/usr/bin/env bash
# Baseline: our own llama-server (router preset) on :18182 behind the logging proxy on :18181.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
RUN=${RUN_DIR:-$HOME/.cache/native-harness/run}
mkdir -p "$RUN"
"$REPO/scripts/baseline-server.sh"
nohup python3 "$REPO/bench/proxy.py" 18181 18182 "$RUN/proxy.jsonl" > "$RUN/proxy.out" 2>&1 &
echo $! > "$RUN/proxy.pid"
sleep 1
curl -sf http://127.0.0.1:18181/health >/dev/null && echo "proxy up on :18181"
