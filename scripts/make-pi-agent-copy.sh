#!/usr/bin/env bash
# Make a working copy of the real pi config (~/.pi/agent) for experiments, so nothing in the
# real directory is edited. Sessions are not copied. In the copy only two things change:
#   - the llama.cpp provider points at our own llama-server (BASELINE_URL) instead of the router;
#   - the llama-native extension from this repo is linked into extensions/ (LINK_NATIVE=0: not).
# Usage: scripts/make-pi-agent-copy.sh [DEST]   (default ~/.cache/native-harness/pi-agent)
set -euo pipefail
SRC=${PI_AGENT_SRC:-$HOME/.pi/agent}
DEST=${1:-$HOME/.cache/native-harness/pi-agent}
BASELINE_URL=${BASELINE_URL:-http://127.0.0.1:18181}
REPO=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$DEST"
rsync -a --delete --exclude sessions --exclude '*~' --exclude 'extensions/llama-native' "$SRC/" "$DEST/"
mkdir -p "$DEST/sessions"
chmod 700 "$DEST"
python3 - "$DEST" "$BASELINE_URL" <<'PY'
import json, sys
dest, url = sys.argv[1], sys.argv[2]
p = f"{dest}/models.json"; d = json.load(open(p))
d["providers"]["llama.cpp"]["baseUrl"] = url
json.dump(d, open(p, "w"), indent=2)
p = f"{dest}/auth.json"; a = json.load(open(p))
if "llama.cpp" in a:
    a["llama.cpp"].setdefault("env", {})["LLAMA_BASE_URL"] = url
json.dump(a, open(p, "w"), indent=2)
PY
if [ "${LINK_NATIVE:-1}" = 1 ]; then
  ln -sfn "$REPO/extension/llama-native" "$DEST/extensions/llama-native"
  echo "pi agent copy: $DEST (llama.cpp -> $BASELINE_URL, llama-native linked)"
else
  echo "pi agent copy: $DEST (llama.cpp -> $BASELINE_URL)"
fi
