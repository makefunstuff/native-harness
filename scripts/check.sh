#!/usr/bin/env bash
# Repository check: unit tests, the lessons bench's ticket self-test, the headless pi smoke test (mock model, copy of the pi config when
# there is one), the local-edit bench self-test, the llama-native experiment's checks that need no llama.cpp build, and the
# d3-context experiment's checks (no GPU, no model).
# PI_EXTRAS_NATIVE_CHECK=1 also builds the native binding (needs llama.cpp, see experimental/llama-native).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x node_modules/.bin/pi ] || npm ci --ignore-scripts --no-audit --no-fund
echo "== unit tests"; node test/run-unit.mjs
echo "== lessons bench self-test (tickets, no model)"; node extensions/lessons/bench/selftest.ts | tail -1
echo "== smoke test (pi -p)"; node test/smoke.mjs
echo "== extensions/local-edit bench"; node extensions/local-edit/bench/selftest.ts
echo "== loop-guard bench tickets"; node extensions/loop-guard/bench/selftest.ts
echo "== experimental/llama-native"
if [ "${PI_EXTRAS_NATIVE_CHECK:-0}" = 1 ]; then experimental/llama-native/scripts/check.sh
else experimental/llama-native/scripts/check.sh --no-build; fi
echo "== experimental/d3-context"; experimental/d3-context/scripts/check.sh
echo "CHECK OK"
