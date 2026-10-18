#!/usr/bin/env bash
# For every long ticket: the broken repo must FAIL the hidden tests; repo + reference overlay must
# PASS both the visible and the hidden tests. Generate the tickets first (bench/gen_long_tasks.py).
cd "$(dirname "$0")/tasks-long"
TMP=${TMPDIR:-$HOME/.cache/pi-extras/d3-context/tmp}; mkdir -p "$TMP"
for t in */; do t=${t%/}
  w=$(mktemp -d -p "$TMP"); cp -r $t/repo/. $w/; cp $t/hidden_test.py $w/
  (cd $w && timeout 60 python3 -m unittest hidden_test >/dev/null 2>&1) && b=PASS || b=fail
  cp -r $t/ref/. $w/
  (cd $w && timeout 60 python3 -m unittest hidden_test >/dev/null 2>&1) && h=PASS || h=FAIL
  (cd $w && timeout 60 python3 -m unittest discover -s tests >/dev/null 2>&1) && v=PASS || v=FAIL
  echo "$t broken-hidden=$b ref-hidden=$h ref-visible=$v"
  [ $h = FAIL ] && (cd $w && python3 -m unittest hidden_test 2>&1 | tail -15)
  rm -rf $w
done
