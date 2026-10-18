#!/usr/bin/env bash
# The measurement in the README: before (gate off) and after (gate on), alternating per round so
# drift hits both arms alike. Runs are sequential.
#   bench/run-all.sh NAME PROVIDER/MODEL[:thinking] [ROUNDS]   ->  results/NAME-base.jsonl, NAME-gate.jsonl
set -euo pipefail
cd "$(dirname "$0")"
name=${1:?NAME}; model=${2:?PROVIDER/MODEL}; rounds=${3:-3}
for r in $(seq 1 "$rounds"); do
  node run.ts "$name-base" --model "$model" --gate off --first-round "$r"
  node run.ts "$name-gate" --model "$model" --gate on --first-round "$r"
done
node report.ts
