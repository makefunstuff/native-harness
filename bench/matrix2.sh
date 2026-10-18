#!/usr/bin/env bash
# Second part: think-route arms and the long-context scenario (context editing, compaction).
set -uo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"
export LLAMA_NATIVE_HELPER_ARGS=configs/helper-qwen3.5-2b.args
run() { python3 bench/run.py "$@" || true; }
lc() { python3 bench/longctx.py "$@" || true; }
scripts/baseline-down.sh >/dev/null 2>&1
scripts/gpu-check.sh || exit 1
run native+think-route --provider llama-native --exp think-route
for r in 1 2; do
  lc native --provider llama-native --round $r
  lc native+prune --provider llama-native --exp prune --round $r
  lc native+branch-compact --provider llama-native --exp branch-compact --round $r
  lc native+helper-compact --provider llama-native --exp helper-compact --round $r
done
scripts/baseline-up.sh || exit 1
run http+think-route --provider llama.cpp --exp think-route
for r in 1 2; do
  lc http --provider llama.cpp --round $r
  lc http+prune --provider llama.cpp --exp prune --round $r
done
scripts/baseline-down.sh
echo MATRIX2 DONE
