#!/usr/bin/env bash
# Run the human's pi (same install, same config) against the experiment copy of ~/.pi/agent,
# without the terminal-integration environment (herdr / orca status hooks would otherwise report
# benchmark runs as the calling agent's state).
REPO=$(cd "$(dirname "$0")/.." && pwd)
export PI_CODING_AGENT_DIR=${PI_CODING_AGENT_DIR:-$HOME/.cache/native-harness/pi-agent}
for v in $(env | grep -oE '^(HERDR|ORCA)_[A-Z0-9_]*'); do unset "$v"; done
exec pi "$@"
