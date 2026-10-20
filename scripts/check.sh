#!/usr/bin/env bash
# Repository check: no Python anywhere, unit tests, the bench ticket self-tests, the shared bench's
# dry run (harness, no model), the headless pi smoke test (mock model, copy of the pi config when
# there is one), the local-edit bench self-test, and the d3-context experiment's checks (no GPU, no
# model). Everything here is TypeScript and runs on node; CI runs this script.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x node_modules/.bin/pi ] || npm ci --ignore-scripts --no-audit --no-fund
echo "== no Python (every script in this repo is TypeScript)"
py=$(git ls-files | grep -E '\.py$' || true)
[ -z "$py" ] || { echo "tracked .py files are not allowed:"; echo "$py"; exit 1; }
py=$(find . -name '*.py' -not -path './node_modules/*' -not -path './.git/*' || true)
[ -z "$py" ] || { echo ".py files are not allowed (untracked too):"; echo "$py"; exit 1; }
for f in requirements.txt pyproject.toml setup.py setup.cfg pytest.ini tox.ini .python-version; do
  if [ -e "$f" ]; then echo "Python config $f is not allowed"; exit 1; fi
done
echo "no .py files, no Python config"
echo "== unit tests"; node test/run-unit.mjs
echo "== bench tickets (self-test: broken fails, reference passes)"; node bench/selftest.ts | tail -1
echo "== bench ticket generator (deterministic)"; node bench/gen-bulk-rename.ts && git diff --exit-code -- bench/tickets/bulk-rename
echo "== bench dry run (harness, no model)"; node bench/run.ts --bench pi-extras --tasks cli-json,ttlcache --arms off,verify-gate --dry-run --out "${PI_EXTRAS_CACHE:-$HOME/.cache/pi-extras}/check/dry-$(date +%s).jsonl" | tail -2
echo "== lessons bench self-test (tickets, no model)"; node extensions/lessons/bench/selftest.ts | tail -1
echo "== smoke test (pi -p)"; node test/smoke.mjs
echo "== extensions/local-edit bench"; node extensions/local-edit/bench/selftest.ts
echo "== loop-guard bench tickets"; node extensions/loop-guard/bench/selftest.ts
echo "== verify-gate bench tickets (self-test)"; node extensions/verify-gate/bench/selftest.ts
echo "== experimental/d3-context"; experimental/d3-context/scripts/check.sh
echo "CHECK OK"
