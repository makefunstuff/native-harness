#!/usr/bin/env bash
# Repository check: unit tests, the headless pi smoke test (mock model, copy of the pi config when
# there is one), and the llama-native experiment's checks that need no llama.cpp build.
# PI_EXTRAS_NATIVE_CHECK=1 also builds the native binding (needs llama.cpp, see experimental/llama-native).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x node_modules/.bin/pi ] || npm ci --ignore-scripts --no-audit --no-fund
echo "== unit tests"; node test/run-unit.mjs
echo "== smoke test (pi -p)"; node test/smoke.mjs
echo "== experimental/llama-native"
if [ "${PI_EXTRAS_NATIVE_CHECK:-0}" = 1 ]; then experimental/llama-native/scripts/check.sh
else experimental/llama-native/scripts/check.sh --no-build; fi
echo "CHECK OK"
