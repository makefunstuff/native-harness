#!/usr/bin/env bash
# Check of the d3-context experiment (no GPU, no model, no API key): generate the long tickets and
# self-test them, report from the recorded rows, check the results archive, and load the extension
# in pi. The top-level scripts/check.sh and CI run it.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(cd "$ROOT/../.." && pwd)
cd "$REPO"
export TMPDIR=${TMPDIR:-$HOME/.cache/pi-extras/d3-context/tmp}; mkdir -p "$TMPDIR"
echo "== long tickets: generate (bench/tasks-long is generated data), self-test"
node experimental/d3-context/bench/gen-long-tasks.ts >/dev/null
out=$(node bench/selftest.ts --tasks-root experimental/d3-context/bench/tasks-long)
echo "$out" | tail -1
! grep -qE "broken-hidden=fail.*ref-hidden=FAIL|ref-hidden=FAIL|ref-visible=FAIL" <<<"$out"
echo "== the context report, from the recorded rows"
node experimental/d3-context/bench/context-report.ts | tail -1
git diff --exit-code -- experimental/d3-context/results/context.md \
  || { echo "experimental/d3-context/results/context.md is stale: commit the regenerated report"; exit 1; }
echo "== results archive"
tar -tJf experimental/d3-context/results/raw-artifacts.tar.xz >/dev/null
echo "archive ok"
echo "== pi loads the extension"
PI=$(command -v "$REPO/node_modules/.bin/pi" || command -v pi)
AGENT=$(mktemp -d -p "$TMPDIR"); echo '{"providers":{}}' > "$AGENT/models.json"
D3_URL=http://127.0.0.1:9/v1 PI_CODING_AGENT_DIR="$AGENT" "$PI" --offline --no-session -ne -e "$ROOT/extension/index.ts" --list-models nothing > "$AGENT/out" 2>&1 || { cat "$AGENT/out"; echo "d3-context extension failed to load"; exit 1; }
if grep -qiE "error|failed to load" "$AGENT/out"; then cat "$AGENT/out"; echo "d3-context extension failed to load"; exit 1; fi
rm -rf "$AGENT"
echo "d3-context extension loads"
echo "D3-CONTEXT CHECK OK"
