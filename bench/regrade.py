#!/usr/bin/env python3
"""Re-grade runs whose grading failed for an infrastructure reason (e.g. ENOSPC in /tmp): rebuild
the final tree from the task repo + the run's saved diff and run the hidden tests again.
Rewrites the rows in results/raw/<arm>.jsonl in place (marks them "regraded": reason).

usage: bench/regrade.py [PATTERN]   (default: rows whose hidden_tail mentions "No space left")
"""
import glob, json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(os.path.dirname(HERE), "results", "raw")
TMP = os.path.expanduser("~/.cache/native-harness/tmp")
pat = sys.argv[1] if len(sys.argv) > 1 else "No space left"
os.makedirs(TMP, exist_ok=True)
env = dict(os.environ, TMPDIR=TMP)
for f in glob.glob(os.path.join(RAW, "*.jsonl")):
    arm = os.path.basename(f)[:-6]
    rows = [json.loads(l) for l in open(f)]
    changed = False
    for r in rows:
        if pat not in r.get("hidden_tail", ""):
            continue
        name = f"{r['task']}-r{r['round']}"
        diff = os.path.join(RAW, arm, name + ".diff")
        w = tempfile.mkdtemp(dir=TMP)
        shutil.copytree(os.path.join(HERE, "tasks", r["task"], "repo"), w, dirs_exist_ok=True)
        subprocess.run("git init -q && git add -A && git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm init",
                       cwd=w, shell=True, env=env)
        text = open(diff).read()
        body = text[text.find("diff --git"):] if "diff --git" in text else ""
        ap = subprocess.run(["git", "apply", "--whitespace=nowarn", "-"], cwd=w, input=body, text=True, capture_output=True, env=env)
        shutil.copy(os.path.join(HERE, "tasks", r["task"], "hidden_test.py"), w)
        h = subprocess.run("python3 -m unittest hidden_test", cwd=w, shell=True, capture_output=True, text=True, timeout=180, env=env)
        print(arm, name, "apply", ap.returncode, "->", "PASS" if h.returncode == 0 else "FAIL")
        if ap.returncode == 0:
            r["passed"] = h.returncode == 0
            r["hidden_tail"] = (h.stdout + h.stderr)[-600:]
            r["regraded"] = pat
            changed = True
        shutil.rmtree(w, ignore_errors=True)
    if changed:
        with open(f, "w") as o:
            for r in rows:
                o.write(json.dumps(r) + "\n")
