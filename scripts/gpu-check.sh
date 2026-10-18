#!/usr/bin/env bash
# Refuse to start a model when the GPUs are in use (the shared llama.cpp router, ComfyUI, ...).
# Prints free VRAM per GPU and exits 1 if any GPU has less than NEED_MIB free.
NEED_MIB=${NEED_MIB:-14000}
ok=0
while IFS=, read -r idx free used; do
  free=${free// /}; used=${used// /}
  echo "GPU$idx free=${free}MiB used=${used}MiB"
  [ "$free" -lt "$NEED_MIB" ] && ok=1
done < <(nvidia-smi --query-gpu=index,memory.free,memory.used --format=csv,noheader,nounits)
[ $ok = 1 ] && echo "not enough free VRAM (need ${NEED_MIB}MiB on each GPU)" >&2
exit $ok
