#!/usr/bin/env bash
# The full benchmark: HTTP arms (baseline server up), then in-process arms (GPUs free).
# Resumable: finished task/round pairs are skipped. Usage: bench/matrix.sh [ROUNDS]
set -uo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"
R=${1:-3}
run() { python3 bench/run.py "$@" || true; }
scripts/baseline-down.sh >/dev/null 2>&1
scripts/baseline-up.sh || exit 1
run http --provider llama.cpp --rounds "$R"
run http+prune --provider llama.cpp --exp prune
run http+done-check --provider llama.cpp --exp done-check
scripts/baseline-down.sh
sleep 5
scripts/gpu-check.sh || exit 1
run native --provider llama-native --rounds "$R"
run native+server-cache --provider llama-native --exp server-cache
run native+no-grammar --provider llama-native --exp no-grammar --rounds 2
run native+no-spec --provider llama-native --exp no-spec
run native+prune --provider llama-native --exp prune
run native+done-check --provider llama-native --exp done-check
LLAMA_NATIVE_HELPER_ARGS=configs/helper-qwen3.5-2b.args run native+helper-decide --provider llama-native --exp helper-decide
echo MATRIX DONE
