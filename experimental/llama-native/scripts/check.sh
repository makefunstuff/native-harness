#!/usr/bin/env bash
# Check of the llama-native experiment (no GPU, no model load): build the binding, syntax-check the
# scripts, self-test the benchmark tasks, check the results archive, and load the pi extension in pi.
# --no-build skips the steps that need a llama.cpp build (the binding and loading it in pi); the
# top-level scripts/check.sh and CI run it that way.
set -euo pipefail
BUILD=1; [ "${1:-}" = "--no-build" ] && BUILD=0
REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"
export TMPDIR=${TMPDIR:-$HOME/.cache/pi-extras/llama-native/tmp}; mkdir -p "$TMPDIR"
LLAMA_DIR=${LLAMA_DIR:-/data/src/llama.cpp-master-77c4540ce}
if [ $BUILD = 1 ]; then
echo "== build native binding"; make -s -C native LLAMA_DIR="$LLAMA_DIR" >/dev/null
node -e 'const m=require("./native/build/llama_native.node"); for (const f of ["load","chat","decide","branchComplete","info","reset","abort"]) if (typeof m[f] !== "function") throw new Error("missing " + f); console.log("addon exports ok")'
fi
echo "== syntax"
python3 -m py_compile bench/*.py
for f in scripts/*.sh bench/*.sh; do bash -n "$f"; done
node --check scripts/smoke.mjs
node --check bench/edit-microbench.mjs
node --check extension/args.cjs
echo "== task self-test"; out=$(bash bench/selftest.sh); echo "$out"; ! grep -qE "broken-hidden=PASS|ref-hidden=FAIL|ref-visible=FAIL" <<<"$out"
echo "== results"; tar -tJf results/raw-artifacts.tar.xz >/dev/null
python3 bench/report.py >/dev/null
echo "archive and report ok"
if [ $BUILD = 0 ]; then echo "LLAMA-NATIVE CHECK OK (no build)"; exit 0; fi
echo "== pi loads the extension"
AGENT=$(mktemp -d); cp -r "$HOME/.pi/agent/models.json" "$AGENT/" 2>/dev/null || echo '{"providers":{}}' > "$AGENT/models.json"
PI_CODING_AGENT_DIR="$AGENT" pi --offline --no-session -ne -e "$REPO/extension/index.ts" --list-models llama-native 2>&1 > "$AGENT/out" || true
grep -q "qwen3.8-27b" "$AGENT/out" || { cat "$AGENT/out"; echo "llama-native model not listed"; exit 1; }
echo "llama-native/qwen3.8-27b listed"
rm -rf "$AGENT"
echo "LLAMA-NATIVE CHECK OK"
