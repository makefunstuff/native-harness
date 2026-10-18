#!/usr/bin/env bash
# Make a working copy of the real pi config (~/.pi/agent) for the benchmark, so nothing in the
# real directory is edited. Sessions are not copied; nothing else changes (both arms use it, the
# d3 arm adds extension/index.ts with pi -e).
# Usage: scripts/make-pi-agent-copy.sh [DEST]   (default ~/.cache/pi-extras/d3-context/pi-agent)
set -euo pipefail
SRC=${PI_AGENT_SRC:-$HOME/.pi/agent}
DEST=${1:-$HOME/.cache/pi-extras/d3-context/pi-agent}
mkdir -p "$DEST"
rsync -a --delete --exclude sessions --exclude '*~' "$SRC/" "$DEST/"
mkdir -p "$DEST/sessions"
chmod 700 "$DEST"
echo "pi agent copy: $DEST"
