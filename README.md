# pi-extras

Extensions that make [pi](https://pi.dev) work better, especially with local models
(llama.cpp, Ollama, LM Studio, vLLM…). It is one pi package: install it once, then turn each
extension on or off on its own.

## Extensions

| extension | what it does | status |
|---|---|---|
| _coming soon_ | the first extensions are being written | |
| [`llama-native`](experimental/llama-native/README.md) | runs llama.cpp inside pi's own process as a model provider (`llama-native/…`); needs a llama.cpp build and a native addon you compile, does nothing without it. Results: [RESULTS.md](experimental/llama-native/RESULTS.md) | **experimental** |

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
      "extensions": ["-experimental/llama-native/extension/index.ts"]
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
  (`~/.pi/agent`, without sessions; an empty config when there is none, as in CI), installs this
  checkout into it, adds a mock OpenAI-compatible model on loopback, and runs `pi -p`: the package
  must load next to everything else in the config, with no extension errors. It then runs every
  `*.smoke.mjs` spec, which scripts the mock model's answers (tool calls included) and checks
  the output; see [`templates/extension/template.smoke.mjs`](templates/extension/template.smoke.mjs).
  `PI_EXTRAS_SMOKE_CONFIG=empty|copy` picks the config, `PI_EXTRAS_SMOKE_MODEL=provider/id` runs
  the first step on a real model instead of the mock.
- **CI**: [GitHub Actions](.github/workflows/ci.yml) runs `scripts/check.sh` on Node 22 and 24.
  `PI_EXTRAS_NATIVE_CHECK=1 scripts/check.sh` also builds the llama-native addon (local only,
  needs llama.cpp).

## Layout

```
extensions/<name>/        one folder per extension (index.ts, tests, README)
experimental/llama-native the in-process llama.cpp experiment: extension, native addon, benchmark, results
templates/extension/      starting point for a new extension
test/                     unit-test runner, smoke test, shared harness (mock model, config copy, fake pi)
scripts/check.sh          repository check (CI)
```

## License

MIT
