#!/usr/bin/env bash
# Repository check (no GPU, no model load): build the binding, syntax-check the scripts, self-test
# the benchmark tasks, check the results archive, and load the pi extension in pi itself.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"
export TMPDIR=${TMPDIR:-$HOME/.cache/native-harness/tmp}; mkdir -p "$TMPDIR"
LLAMA_DIR=${LLAMA_DIR:-/data/src/llama.cpp-master-77c4540ce}
echo "== build native binding"; make -s -C native LLAMA_DIR="$LLAMA_DIR" >/dev/null
node -e 'const m=require("./native/build/llama_native.node"); for (const f of ["load","chat","decide","branchComplete","info","reset","abort"]) if (typeof m[f] !== "function") throw new Error("missing " + f); console.log("addon exports ok")'
echo "== syntax"
python3 -m py_compile bench/*.py
for f in scripts/*.sh bench/*.sh; do bash -n "$f"; done
node --check scripts/smoke.mjs
node --check bench/edit-microbench.mjs
node --check extension/llama-native/args.cjs
echo "== task self-test"; out=$(bash bench/selftest.sh); echo "$out"; ! grep -qE "broken-hidden=PASS|ref-hidden=FAIL|ref-visible=FAIL" <<<"$out"
echo "== long tickets (HRN-2): generate (bench/tasks-long is not committed), self-test"
python3 bench/gen_long_tasks.py >/dev/null
out=$(bash bench/selftest.sh tasks-long); echo "$out"; ! grep -qE "broken-hidden=PASS|ref-hidden=FAIL|ref-visible=FAIL" <<<"$out"
echo "== results"; tar -tJf results/raw-artifacts.tar.xz >/dev/null
python3 bench/report.py >/dev/null
if [ -f results/ctx/raw-artifacts.tar.xz ]; then tar -tJf results/ctx/raw-artifacts.tar.xz >/dev/null; fi
python3 bench/ctx_report.py >/dev/null; git diff --quiet -- results/ctx/summary.md || { echo "results/ctx/summary.md is stale: run bench/ctx_report.py"; exit 1; }
echo "archive and report ok"
echo "== pi loads the extension"
AGENT=$(mktemp -d -p "$TMPDIR"); cp -r "$HOME/.pi/agent/models.json" "$AGENT/" 2>/dev/null || echo '{"providers":{}}' > "$AGENT/models.json"
PI_CODING_AGENT_DIR="$AGENT" pi --offline --no-session -ne -e "$REPO/extension/llama-native/index.ts" --list-models llama-native 2>&1 > "$AGENT/out" || true
grep -q "qwen3.8-27b" "$AGENT/out" || { cat "$AGENT/out"; echo "llama-native model not listed"; exit 1; }
echo "llama-native/qwen3.8-27b listed"
echo '{"providers":{}}' > "$AGENT/models.json"
D3_URL=http://127.0.0.1:9/v1 PI_CODING_AGENT_DIR="$AGENT" pi --offline --no-session -ne -e "$REPO/extension/d3-context/index.ts" --list-models deepseek > "$AGENT/out2" 2>&1 || { cat "$AGENT/out2"; echo "d3-context extension failed to load"; exit 1; }
grep -qi "error\|failed" "$AGENT/out2" && { cat "$AGENT/out2"; echo "d3-context extension failed to load"; exit 1; }
echo "d3-context extension loads"
rm -rf "$AGENT"
echo "CHECK OK"
