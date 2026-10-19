#!/usr/bin/env bash
# The measurement in the README: before (pi's edit) and after (local-edit), one run at a time,
# rounds alternating between the arms so drift on a shared server hits both alike. Resumable:
# finished ticket/round pairs are skipped. Usage: bench/run-all.sh local|cloud [ROUNDS]
# LOCAL_MODEL / CLOUD_MODEL override the models; LOCAL_EDIT_RESULTS the results directory.
set -euo pipefail
cd "$(dirname "$0")"
which=${1:?local|cloud}; rounds=${2:-6}
case $which in
  local) model=${LOCAL_MODEL:-llama.cpp/qwen3.8-27b:medium} ;;
  cloud) model=${CLOUD_MODEL:-deepseek/deepseek-flash} ;;  # Sonnet 5.5 edits through bash scripts: 0 edit calls
  *) echo "local|cloud" >&2; exit 2 ;;
esac
for r in $(seq 1 "$rounds"); do
  node run.ts "$which-base" --model "$model" --edit base --first-round "$r"
  node run.ts "$which-local-edit" --model "$model" --edit local-edit --first-round "$r"
done
node report.ts
