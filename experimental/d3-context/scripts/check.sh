#!/usr/bin/env bash
# Check of the d3-context experiment (no GPU, no model, no API key): syntax-check the scripts,
# generate and self-test the long tickets, check the results archive and that the summary is
# current, and load the extension in pi. The top-level scripts/check.sh and CI run it.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
export TMPDIR=${TMPDIR:-$HOME/.cache/pi-extras/d3-context/tmp}; mkdir -p "$TMPDIR"
echo "== syntax"
python3 -m py_compile bench/*.py
for f in scripts/*.sh bench/*.sh; do bash -n "$f"; done
echo "== long tickets: generate (bench/tasks-long is not committed), self-test"
python3 bench/gen_long_tasks.py >/dev/null
out=$(bash bench/selftest.sh); echo "$out"; ! grep -qE "broken-hidden=PASS|ref-hidden=FAIL|ref-visible=FAIL" <<<"$out"
echo "== results"
tar -tJf results/raw-artifacts.tar.xz >/dev/null
cp results/summary.md "$TMPDIR/summary.before"
python3 bench/ctx_report.py >/dev/null
cmp -s results/summary.md "$TMPDIR/summary.before" || { echo "results/summary.md was stale (now regenerated): commit it"; exit 1; }
rm -f "$TMPDIR/summary.before"
echo "archive and summary ok"
echo "== pi loads the extension"
PI=$(command -v "$ROOT/../../node_modules/.bin/pi" || command -v pi)
AGENT=$(mktemp -d -p "$TMPDIR"); echo '{"providers":{}}' > "$AGENT/models.json"
D3_URL=http://127.0.0.1:9/v1 PI_CODING_AGENT_DIR="$AGENT" "$PI" --offline --no-session -ne -e "$ROOT/extension/index.ts" --list-models nothing > "$AGENT/out" 2>&1 || { cat "$AGENT/out"; echo "d3-context extension failed to load"; exit 1; }
if grep -qiE "error|failed to load" "$AGENT/out"; then cat "$AGENT/out"; echo "d3-context extension failed to load"; exit 1; fi
rm -rf "$AGENT"
echo "d3-context extension loads"
echo "D3-CONTEXT CHECK OK"
