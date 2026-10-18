#!/usr/bin/env bash
# Stop the benchmark if the shared llama.cpp router gets a request while we hold the GPUs, so the
# router (other people/agents) can load its model. Usage: bench/watchdog.sh MATRIX_PID
MATRIX=$1
REPO=$(cd "$(dirname "$0")/.." && pwd)
SINCE=$(date '+%Y-%m-%d %H:%M:%S')
while kill -0 "$MATRIX" 2>/dev/null; do
  if journalctl -u local-ai-router --since "$SINCE" --no-pager -o cat 2>/dev/null | grep -qE "proxying request|exiting sleeping state"; then
    echo "$(date) router activity: stopping the benchmark" | tee -a "$HOME/.cache/native-harness/run/watchdog.log"
    pkill -P "$MATRIX"; kill "$MATRIX"
    pkill -f "pi-agent.*--session-dir" ; pkill -f "native-harness/work" 
    "$REPO/scripts/baseline-down.sh"
    exit 1
  fi
  sleep 5
done
