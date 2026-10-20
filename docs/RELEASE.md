# Cutting a release

Everything here runs from the repository root, on a checkout of `main`. Nothing in this procedure
touches the owner's `~/.pi/agent`: the install check uses a throw-away config directory.

## 1. Version and changelog

- `package.json` (and `package-lock.json`) carry the version:
  `npm version <x.y.z> --no-git-tag-version --allow-same-version`
- `CHANGELOG.md`: a dated section for the release — each extension, what it does, its measured
  before/after numbers, and the known gaps (what was not measured, and what is still open).
  Numbers come from the recorded rows in `extensions/<name>/bench/results/`: a release never
  re-runs a benchmark, it reports what is recorded. If an extension has no recorded local numbers,
  say so in the changelog and in its README; do not run one for the release.
- `README.md`: the release line at the top, the table, and the section per extension
  (what it fixes, how to enable and configure it, its measured numbers).

## 2. The repository check

```bash
PI_EXTRAS_SMOKE_CONFIG=empty scripts/check.sh     # what CI runs, on a clean pi config
```

It starts with two rules of its own: the no-Python rule (`scripts/no-python.sh`) and the
**public-repo rule** (`node scripts/no-secrets.mjs`): no key, secret, personal path
(`/home/<user>/…`, `/Users/<user>/…`, `/root/…`), routable IP address or tailnet hostname anywhere
in the tree — tracked, untracked, or written by a ticket generator. A line that must stay (the
rule's own pattern, a synthetic public fixture a test needs) carries `no-secrets: allow` and says
why. CI runs the same step.

## 3. The install check, on a clean config copy

`pi install git:…` is how the package is installed, so the release is only checked through it.

The automated form is the smoke test in step 2: it builds a git snapshot of the working tree, makes
a throw-away pi config (`PI_EXTRAS_SMOKE_CONFIG=empty`: an empty config, `copy`: a copy of
`~/.pi/agent` without sessions), runs `pi install git:github.com/makefunstuff/pi-extras` into it,
adds a mock OpenAI-compatible model on loopback, and runs `pi -p` — the package must load next to
everything else in that config with no extension errors.

After the tag is pushed, check the real thing (a clean config, and the tag, not the checkout):

```bash
agent=$(mktemp -d)                                  # never $PI_CODING_AGENT_DIR, never ~/.pi/agent
PI_CODING_AGENT_DIR=$agent pi install git:github.com/makefunstuff/pi-extras@v<x.y.z>
PI_CODING_AGENT_DIR=$agent pi list                  # the package and its extensions are listed
PI_CODING_AGENT_DIR=$agent pi -p --offline --no-mcp --no-session --model <a model you have> 'say ok'
rm -rf $agent
```

`pi list` must show `git:github.com/makefunstuff/pi-extras` and its extension files; the `pi -p`
run must print no extension load error.

## 4. Tag and GitHub release

Commit the version, changelog and README changes and get them onto `main`. Then:

```bash
git tag -a v<x.y.z> -m "pi-extras v<x.y.z>"
git push origin main v<x.y.z>
```

Pushing the tag runs [.github/workflows/release.yml](../.github/workflows/release.yml): it re-runs
the public-repo rule and `scripts/check.sh` on the tagged commit, builds the release notes from that
version's `CHANGELOG.md` section (`node scripts/release-notes.mjs v<x.y.z> [out.md]`, which refuses a
version that does not match `package.json` and notes that fail the public-repo rules), and creates
the GitHub release.

By hand, the same steps:

```bash
node scripts/release-notes.mjs v<x.y.z> /tmp/notes.md   # the version's changelog section, checked
gh release create v<x.y.z> --target main --title "pi-extras v<x.y.z>" --notes-file /tmp/notes.md --verify-tag
```

The notes and the repository are public, and the release workflow will not publish a tree that
fails `scripts/no-secrets.mjs`. Recorded benchmark rows are machine output, so read the findings
before adding an allow marker: `/home/<user>/…` in a recorded row is a finding to fix, not to
allow.

## 5. npm

The package is **not** published to npm; `package.json` is `"private": true` so a release cannot
publish it by accident. `pi install git:…` clones the repository, so npm is not needed to install
pi-extras. Publish to npm only if the owner says so: then drop `"private"`,
check `files` in `package.json` (it is what npm ships), and `npm publish` the same commit as the tag.
