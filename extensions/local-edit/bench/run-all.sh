#!/usr/bin/env bash
# The measurement in the README: before (pi's edit) and after (local-edit), alternating per round so
# drift on the shared router hits both arms alike. Usage: bench/run-all.sh local|cloud [ROUNDS]
#   LOCAL_EDIT_CAPABILITY_SUITE=<homelab>/evals/local-ai-campaign-2026-09-08/capability-suite adds
#   its three code tasks; LOCAL_MODEL / CLOUD_MODEL override the models.
set -euo pipefail
cd "$(dirname "$0")"
which=${1:?local|cloud}; rounds=${2:-2}
case $which in
  local) model=${LOCAL_MODEL:-llama.cpp/qwen3.8-27b:medium} ;;
  cloud) model=${CLOUD_MODEL:-deepseek/deepseek-flash} ;;  # Sonnet 5.5 edits through bash scripts: 0 edit calls
  *) echo "local|cloud" >&2; exit 2 ;;
esac
for r in $(seq 1 "$rounds"); do
  python3 run.py "$which-base" --model "$model" --edit base --first-round "$r"
  python3 run.py "$which-local-edit" --model "$model" --edit local-edit --first-round "$r"
done
python3 report.py
