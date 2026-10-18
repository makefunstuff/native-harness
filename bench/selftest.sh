#!/usr/bin/env bash
# For every task: the broken repo must FAIL the hidden tests; repo + reference overlay must
# PASS both the visible and the hidden tests.
cd "$(dirname "$0")/tasks"
for t in */; do t=${t%/}
  w=$(mktemp -d); cp -r $t/repo/. $w/; cp $t/hidden_test.py $w/
  (cd $w && timeout 60 python3 -m unittest hidden_test >/dev/null 2>&1) && b=PASS || b=fail
  cp -r $t/ref/. $w/
  (cd $w && timeout 60 python3 -m unittest hidden_test >/dev/null 2>&1) && h=PASS || h=FAIL
  (cd $w && timeout 60 python3 -m unittest discover -s tests >/dev/null 2>&1) && v=PASS || v=FAIL
  echo "$t broken-hidden=$b ref-hidden=$h ref-visible=$v"
  [ $h = FAIL ] && (cd $w && python3 -m unittest hidden_test 2>&1 | tail -15)
  rm -rf $w
done
