#!/usr/bin/env bash
# Stop the baseline llama-server and proxy started by baseline-up.sh.
RUN=${RUN_DIR:-$HOME/.cache/pi-extras/llama-native/run}
for f in server proxy; do
  [ -f "$RUN/$f.pid" ] && kill "$(cat "$RUN/$f.pid")" 2>/dev/null && echo "stopped $f"
  rm -f "$RUN/$f.pid"
done
for i in $(seq 1 30); do pgrep -f "llama-server.*--port 18182" >/dev/null || break; sleep 1; done
