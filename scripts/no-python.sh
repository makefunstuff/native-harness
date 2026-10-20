#!/usr/bin/env bash
# The repository's no-Python rule, in one place: no .py file (tracked, untracked, or written by a
# ticket generator), no Python bytecode, no Python config.
#
# CI runs this as its first step (before npm ci, so a Python file fails the build at once), and
# scripts/check.sh calls no_python at the start and again at the end, after the ticket generators
# have written their trees. Everything here is a shell check on node-only code: this repo has no
# Python runtime, and `npm ci` is the only install.
set -euo pipefail

PY_CONFIG="requirements.txt pyproject.toml setup.py setup.cfg pytest.ini tox.ini .python-version Pipfile poetry.lock"

no_python() {
	local bad
	bad=$(git ls-files | grep -E '\.(py|pyc|pyo|pyi|pyz)$|/__pycache__/' || true)
	[ -z "$bad" ] || { echo "tracked Python files are not allowed:"; echo "$bad"; return 1; }
	bad=$(find . \( -name node_modules -o -name .git \) -prune -o \
		\( -name '*.py' -o -name '*.pyc' -o -name '*.pyo' -o -name '*.pyi' -o -name '*.pyz' -o -name '__pycache__' \) -print || true)
	[ -z "$bad" ] || { echo "Python files are not allowed (untracked and generated too):"; echo "$bad"; return 1; }
	for f in $PY_CONFIG; do
		if [ -e "$f" ]; then echo "Python config $f is not allowed"; return 1; fi
	done
	return 0
}

# Run directly (CI): check from the repository root.
if [ "$(basename "${BASH_SOURCE[0]}")" = "$(basename "${0}")" ]; then
	cd "$(dirname "${BASH_SOURCE[0]}")/.."
	no_python
	echo "no Python files, no Python config"
fi
