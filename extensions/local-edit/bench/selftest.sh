#!/usr/bin/env bash
# Checks for the local-edit bench (no model needed):
#   - gen_tasks.py reproduces the committed tickets in bench/tasks/ byte for byte;
#   - for every edit ticket the original repo FAILS the hidden tests only on the requested
#     behaviour (its untouched-code check passes), and the reference solution PASSES the hidden
#     and the visible tests;
#   - run.py, report.py compile; replay.mjs loads.
set -euo pipefail
cd "$(dirname "$0")"
TMP=$(mktemp -d -p "${TMPDIR:-/tmp}" local-edit-selftest.XXXXXX); trap 'rm -rf "$TMP"' EXIT
python3 gen_tasks.py "$TMP/generated" >/dev/null
diff -r tasks "$TMP/generated" >/dev/null || { echo "bench/tasks differs from gen_tasks.py output" >&2; diff -r tasks "$TMP/generated" | head -20 >&2; exit 1; }
fail=0
for t in tasks/*/; do t=${t%/}; n=$(basename $t)
  w="$TMP/$n"; cp -r $t/repo "$w"; cp $t/hidden_test.py "$w/"
  out=$(cd "$w" && timeout 60 python3 -m unittest hidden_test 2>&1) && b=PASS || b=fail
  echo "$out" | grep -qE "^(FAIL|ERROR): test_(others_untouched|other_lines_untouched|tabs_kept)" && u=FAIL || u=ok
  rm -rf "$w"; cp -r $t/ref "$w"; cp $t/hidden_test.py "$w/"
  (cd "$w" && timeout 60 python3 -m unittest hidden_test >/dev/null 2>&1) && h=PASS || h=FAIL
  (cd "$w" && timeout 60 python3 -m unittest discover -s tests >/dev/null 2>&1) && v=PASS || v=FAIL
  echo "$n broken-hidden=$b broken-untouched=$u ref-hidden=$h ref-visible=$v"
  [ $b = fail ] && [ $u = ok ] && [ $h = PASS ] && [ $v = PASS ] || fail=1
done
python3 -m py_compile run.py report.py gen_tasks.py
rm -rf __pycache__
node --input-type=module -e "await import('$PWD/../match.ts'); await import('$PWD/../paths.ts');"
[ $fail = 0 ] && echo "LOCAL-EDIT BENCH SELFTEST OK"
