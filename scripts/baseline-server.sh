#!/usr/bin/env bash
# Start our own llama-server with the router's qwen3.8-27b preset (configs/qwen3.8-27b.args),
# on loopback, so the shared router is not touched. Writes its pid to $RUN_DIR/server.pid.
#   LLAMA_BIN  directory with llama-server (default: the router's build)
#   PORT       default 18182 (the logging proxy listens on 18181 in front of it)
#   EXTRA_ARGS_FILE  optional second argument file appended to the preset (e.g. configs/http-tuned.args)
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
LLAMA_BIN=${LLAMA_BIN:-/data/src/llama.cpp-master-77c4540ce/build-cuda/bin}
PORT=${PORT:-18182}
RUN_DIR=${RUN_DIR:-$HOME/.cache/native-harness/run}
mkdir -p "$RUN_DIR"
"$REPO/scripts/gpu-check.sh"
mapfile -t ARGS < <(node -e '
  const { readArgs } = require(process.argv[1]);
  for (const a of readArgs(process.argv[2])) console.log(a);' "$REPO/extension/llama-native/args.cjs" "$REPO/configs/qwen3.8-27b.args")
EXTRA=()
if [ -n "${EXTRA_ARGS_FILE:-}" ]; then
  mapfile -t EXTRA < <(node -e '
    const { readArgs } = require(process.argv[1]);
    for (const a of readArgs(process.argv[2])) console.log(a);' "$REPO/extension/llama-native/args.cjs" "$EXTRA_ARGS_FILE")
fi
"$LLAMA_BIN/llama-server" "${ARGS[@]}" "${EXTRA[@]}" --host 127.0.0.1 --port "$PORT" --alias qwen3.8-27b \
  --metrics --timeout 3600 --threads-http 8 --log-colors off --log-file "$RUN_DIR/server.log" \
  > "$RUN_DIR/server.stdout" 2>&1 &
echo $! > "$RUN_DIR/server.pid"
for i in $(seq 1 300); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { echo "llama-server up on :$PORT (pid $(cat "$RUN_DIR/server.pid"))"; exit 0; }
  kill -0 "$(cat "$RUN_DIR/server.pid")" 2>/dev/null || { echo "llama-server died"; tail -20 "$RUN_DIR/server.stdout"; exit 1; }
  sleep 1
done
echo "timeout waiting for llama-server"; exit 1
