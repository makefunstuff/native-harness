#!/usr/bin/env bash
# Run the human's pi (same install) on the experiment's copy of its config
# (scripts/make-pi-agent-copy.sh), without the terminal-integration environment (herdr / orca
# status hooks would otherwise report benchmark runs as the calling agent's state).
export PI_CODING_AGENT_DIR=${PI_CODING_AGENT_DIR:-$HOME/.cache/pi-extras/d3-context/pi-agent}
for v in $(env | grep -oE '^(HERDR|ORCA)_[A-Z0-9_]*'); do unset "$v"; done
# temp files (bash output spills, compile cache) on disk, not in a shared tmpfs
export TMPDIR=${NH_TMPDIR:-$HOME/.cache/pi-extras/d3-context/tmp}
mkdir -p "$TMPDIR"
exec pi "$@"
