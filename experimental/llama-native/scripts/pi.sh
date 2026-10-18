#!/usr/bin/env bash
# Run the human's pi (same install, same config) against the experiment copy of ~/.pi/agent,
# without the terminal-integration environment (herdr / orca status hooks would otherwise report
# benchmark runs as the calling agent's state).
REPO=$(cd "$(dirname "$0")/.." && pwd)
export PI_CODING_AGENT_DIR=${PI_CODING_AGENT_DIR:-$HOME/.cache/pi-extras/llama-native/pi-agent}
for v in $(env | grep -oE '^(HERDR|ORCA)_[A-Z0-9_]*'); do unset "$v"; done
# temp files (bash output spills, compile cache) on disk, not in a shared tmpfs
export TMPDIR=${NH_TMPDIR:-$HOME/.cache/pi-extras/llama-native/tmp}
mkdir -p "$TMPDIR"
exec pi "$@"
