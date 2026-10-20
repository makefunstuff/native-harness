# pi-extras

Extensions that make [pi](https://pi.dev) work better, especially with local models
(llama.cpp, Ollama, LM Studio, vLLM…). It is one pi package: install it once, then turn each
extension on or off on its own.

## Extensions

| extension | what it does | status |
|---|---|---|
| [`lessons`](extensions/lessons/README.md) | when something failed and was then fixed, asks for a short cue / lesson / evidence note and keeps it (Hindsight memory, or a local file); at the start of the next task in the same repo, appends only the notes that apply (Jev decides), so the mistake is not repeated. No system-prompt text, no tool | **beta** |
| [`local-edit`](extensions/local-edit/README.md) | replaces pi's `edit`. It places near misses when exactly one spot fits (indentation ignored, or ≥ 0.95 similar), and on a miss shows the closest lines with line numbers. Every edit returns a compact diff of removed and added lines. It also repairs basename and `path#tag` paths. Same tool schema, so the prompt cache is kept. Cloud results in; local numbers on Strata (reduced sample) | **new** |
| [`loop-guard`](extensions/loop-guard/README.md) | notices blind retries of a failed tool call, repeated no-progress calls and runs that stop on "I'll …" with no tool call, and appends a short correction (never rewrites history, so the prompt cache stays) | stable |
| [`thinking-guard`](extensions/thinking-guard/README.md) | stops runaway thinking: gives llama.cpp servers a per-request thinking budget, and aborts and re-issues a reply that still thinks too long, with a "stop deliberating, act with a tool" note appended (append-only, so the prompt cache survives) | on for local models |
| [`verify-gate`](extensions/verify-gate/README.md) | runs the project's check (`.pi/verify` or AGENTS.md) before the agent may finish after editing files; on failure the agent gets the output for another round (at most 2). Adds a prompt line: tests must not share assumptions with the code | stable |
| [`d3-context`](experimental/d3-context/README.md) | lets a local decision model (vllm-d3 over the System One wire) keep, summarise or drop old tool output and pin key lines, editing the context at subtask boundaries; needs `D3_URL`, not in the package manifest (load with `pi -e`). Result: no gain, higher cost with cached providers: [RESULTS.md](experimental/d3-context/RESULTS.md) | **experimental** |

Each extension lives in its own folder under `extensions/<name>/` with its own README;
experimental extras live under `experimental/`.

## Install

Needs pi 1.3.0 or newer (and Node 22.19+, which pi needs anyway).

```bash
pi install git:github.com/makefunstuff/pi-extras          # personal, ~/.pi/agent/settings.json
pi install -l git:github.com/makefunstuff/pi-extras       # this project only, .pi/settings.json
pi install git:github.com/makefunstuff/pi-extras@<tag>    # pinned to a tag or commit
pi -e git:github.com/makefunstuff/pi-extras               # try it for one run, no install
```

`pi update --extensions` pulls the latest version; `pi remove git:github.com/makefunstuff/pi-extras`
removes it.

## Enable and disable extensions

All extensions of the package load by default. To choose:

```bash
pi config          # TUI: toggle each pi-extras extension (Tab switches personal / project scope)
pi config -l       # start in the project scope
```

or filter in `settings.json` (`-path` drops one extension, `[]` drops all of them):

```json
{
  "packages": [
    {
      "source": "git:github.com/makefunstuff/pi-extras",
      "extensions": ["-extensions/lessons/index.ts"]
    }
  ]
}
```

## Development

```bash
npm ci --ignore-scripts        # pi 1.3.0 as a dev dependency, for the tests
npm test                       # unit tests (node:test, TypeScript via node's type stripping)
npm run smoke                  # headless pi -p smoke test against a mock model
scripts/check.sh               # everything CI runs
pi install "$PWD"              # use your checkout as the installed package
```

- **New extension**: copy [`templates/extension/`](templates/extension/README.md) to
  `extensions/<name>/`. The package manifest (`pi.extensions` in `package.json`) picks up every
  `extensions/*/index.ts`, so nothing else needs registering. Add a line to the table above.
- **Unit tests**: `*.test.ts` next to the code. [`test/lib/fake-pi.ts`](test/lib/fake-pi.ts) is a
  stand-in for pi's extension API that records registered tools, commands and providers and fires
  events.
- **Smoke test**: [`test/smoke.mjs`](test/smoke.mjs) makes a throw-away copy of your pi config
  (`~/.pi/agent`, without sessions; an empty config when there is none, as in CI), installs the
  package into it the way users do, `pi install git:github.com/makefunstuff/pi-extras`, served
  from a snapshot of the working tree (so without the dev `node_modules`), adds a mock
  OpenAI-compatible model on loopback, and runs `pi -p`: the package must load next to everything
  else in the config, with no extension errors. It then runs every
  `*.smoke.mjs` spec, which scripts the mock model's answers (tool calls included) and checks
  the output; see [`templates/extension/template.smoke.mjs`](templates/extension/template.smoke.mjs).
  `PI_EXTRAS_SMOKE_CONFIG=empty|copy` picks the config, `PI_EXTRAS_SMOKE_INSTALL=path` skips
  the git install, `PI_EXTRAS_SMOKE_MODEL=provider/id` runs
  the first step on a real model instead of the mock.
- **Bench**: [`bench/`](bench/README.md) is one shared bench for every extension and experiment:
  tickets (`issue.md`, `repo/`, `hidden.test.ts`, `ref/`), arms, pi driven in-process through its
  SDK (`createAgentSession`), and reports over recorded rows. `node bench/run.ts --bench pi-extras`,
  `--bench d3-context`; `node bench/selftest.ts` checks the tickets without a model, and
  `--dry-run` checks the harness the same way.
- **Dependencies**: runtime packages an extension imports go in `dependencies`. pi provides
  `@earendil-works/pi-*` and `typebox` itself: import them, never list them in `dependencies` or
  `peerDependencies` (next to the pi devDependency, npm would then lock them for production and
  git installs would get their own copy); `test/package.test.mjs` checks this.
- **CI**: [GitHub Actions](.github/workflows/ci.yml) runs `scripts/check.sh` on Node 22 and 24.
  It starts with a **no-Python check**: a `.py` file, tracked or not, or a Python config file
  (`requirements.txt`, `pyproject.toml`, …) fails the run. Everything in this repo is TypeScript
  and runs on node.

## Layout

```
extensions/<name>/        one folder per extension (index.ts, tests, README)
experimental/<name>/      an experiment: extension, bench, results (its own README)
bench/                    the shared bench: tickets, arms, pi in-process through its SDK, reports
templates/extension/      starting point for a new extension
test/                     unit-test runner, smoke test, shared harness (mock model, config copy, fake pi)
scripts/check.sh          repository check (CI)
```

## Removed

- **2026-10-20: `experimental/llama-native`** — the in-process llama.cpp provider (extension, C++
  addon, benchmark, results). It needed a llama.cpp build and a compiled addon, measured the same
  tickets over HTTP and in-process, and lost: the answer is in its `RESULTS.md`, which is in the
  history — `git log --oneline -- experimental/llama-native` for the commits,
  `git show <commit>:experimental/llama-native/RESULTS.md` to read it.
- **2026-10-20: Python.** The benches were Python (a runner, a reporter, a proxy, ticket generators
  per experiment). They are one TypeScript bench now, `bench/`, driving pi in-process through its
  SDK; ticket repos and hidden tests are TypeScript, graded with `node --test`. The recorded runs
  stay as data (`.jsonl` rows, summary tables, `RESULTS.md`), and CI fails if a `.py` file appears.

## License

MIT
