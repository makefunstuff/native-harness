# native-harness

An experiment: run the agent harness's model **inside** the llama.cpp runtime, in the same
process, instead of the harness talking to `llama-server` over HTTP.

Agent harnesses (pi, Claude Code, Codex…) drive a model through an OpenAI-style API. The runtime
(llama.cpp here) only sees one request at a time and knows nothing about the loop around it.
Putting llama.cpp into the harness's process gives the harness direct access to the KV cache,
logits, sampling and every loaded model, which may allow:

- **dynamic context**: keep, drop, summarise or reorder parts of the context in the cache between
  steps, instead of re-sending and re-processing whole prompts;
- **several models at once**: a small model drafts, routes or summarises while the large one
  reasons, sharing memory;
- **decision calls**: classifier-style calls (logprobs over a few choices) for cheap routing and
  "is this done?" decisions, on a fork of the cached conversation;
- **no network round trip** and no re-tokenising of the whole conversation each turn.

The harness is **pi** (the coding agent used for local models here), unchanged: the human's own
pi install and configuration. llama.cpp is added to it as one more model provider, `llama-native`,
loaded into pi's Node process through a Node-API binding of libllama. The results are in
[RESULTS.md](RESULTS.md).

## How it fits together

```
 pi (unchanged: same tools, extensions, skills, MCP, settings)
  │  built-in OpenAI-completions client  ── builds the request exactly as for the llama.cpp provider
  │
  ├─ provider "llama.cpp"     fetch() ──HTTP──▶ llama-server (router preset)          ← baseline
  │
  └─ provider "llama-native"  fetch() ──in-process──▶ extension/llama-native
                                                       │  Node-API (one worker thread per model)
                                                       ▼
                                          native/llama_native.node
                                           Service: chat templates + parser (llama.cpp common),
                                                    per-message cache segments, decisions on a branch
                                           Engine:  libllama context, DFlash2 speculative decoding,
                                                    checkpoints of the recurrent state, seq 1 fork
```

- **The request is identical on both paths.** The extension registers `llama-native` with pi's own
  `streamSimpleOpenAICompletions` and only swaps its `fetch` for an in-process one, so message
  conversion, tool-call handling, thinking, usage accounting, retries and abort are pi's code in
  both cases. The model entry mirrors the human's `models.json` entry for `llama.cpp/qwen3.8-27b`
  (compat flags, thinking levels, limits).
- **The model and its settings are identical.** `configs/qwen3.8-27b.args` is the router's
  `[qwen3.8-27b]` preset as llama-server arguments (QUASAR NVFP4 Qwen3.8-27B, 131072 context,
  tensor split over both GPUs, DFlash2 drafter plus n-gram speculation, q8_0 KV, the same sampling).
  The baseline starts llama-server with this file; the binding parses the very same file with
  llama.cpp's own argument parser. The binding links the router's llama.cpp build
  (`/data/src/llama.cpp-master-77c4540ce`), so both paths run the same kernels.
- **What the binding does differently** (all switchable, see Experiments): it tokenises the
  conversation per message and keeps a checkpoint of the model's recurrent state at every message
  boundary (Qwen3.8 is a hybrid Gated-DeltaNet model: its state cannot be rewound to an arbitrary
  position, only restored from a snapshot); it reuses the exact tokens it generated for earlier
  assistant messages instead of re-tokenising their rendering; and it can fork the cached
  conversation into a second sequence for a decision or a summary, without touching the main one.

### Why a Node-API addon in C++

pi is a Node program and its extensions run in its process, so "in-process" means a native
addon. Alternatives considered:

- **node-llama-cpp** (npm): bundles its own llama.cpp build. We need the router's build (CUDA 13.3
  for sm_120 FP4 tensor cores, NVFP4 weights, the DFlash2 drafter, tensor split) and llama.cpp's
  `common` library (chat templates, tool-call parser and grammar, speculative decoding), which it
  does not expose.
- **A standalone C++ harness**: started, then dropped on request: the point is to keep pi.
- **Raw Node-API instead of node-addon-api / node-gyp**: one C file-level dependency
  (`node_api.h` ships with Node), a plain Makefile, ABI-stable across Node versions.

The C++ side reuses llama.cpp's `common` code wherever llama-server does (argument parsing,
`common_chat_session` for templates, grammar and parsing, `common_speculative` for DFlash2,
`common_sampler`), so behaviour matches the server; the new code is the cache bookkeeping
(`native/engine.cpp`), the chat service (`native/service.cpp`) and the binding (`native/addon.cpp`).

## Build

Needs a built llama.cpp checkout with shared libraries (`-DBUILD_SHARED_LIBS=ON`, CUDA) and Node.

```bash
make -C native LLAMA_DIR=/data/src/llama.cpp-master-77c4540ce      # -> native/build/llama_native.node
node scripts/smoke.mjs                                               # load, one tool call, one decision
```

`LLAMA_BUILD` (default `$LLAMA_DIR/build-cuda`) points at the build directory. The addon is linked
with an rpath to it. Build against the same checkout that produced the libraries: `common/` is a
C++ API without ABI guarantees.

## Install into pi

The extension is additive: nothing in `~/.pi/agent` is edited.

```bash
ln -s "$PWD/extension/llama-native" ~/.pi/agent/extensions/llama-native
pi --model llama-native/qwen3.8-27b          # or pick "… (in-process)" in /model
```

pi then has one more model, `llama-native/qwen3.8-27b`, next to `llama.cpp/qwen3.8-27b`; tools,
memory, skills, MCP and the other extensions work as before. The model loads on the first request
of a pi process (about 5 s from the page cache, 80 s cold) and stays loaded until pi exits.

It needs the GPUs the way a router preset does: it refuses to load when either GPU has less than
`LLAMA_NATIVE_MIN_FREE_MIB` (13500) free, for example while the router has a model loaded. To
remove it, delete the symlink.

Environment (all optional): `LLAMA_NATIVE_ARGS` (argument file), `LLAMA_NATIVE_ADDON`,
`LLAMA_NATIVE_MODEL` (which `llama.cpp` model entry to mirror), `LLAMA_NATIVE_EXP` (experiments),
`LLAMA_NATIVE_HELPER_ARGS` (second model), `LLAMA_NATIVE_MAX_CKPT` (checkpoints kept, default 32;
each is ~150 MB of RAM for this model), `LLAMA_NATIVE_METRICS` (JSONL per request),
`MODEL_DIR` / `HELPER_DIR` (used in the argument files).

## Experiments

Switched with `LLAMA_NATIVE_EXP=a,b,…`; implemented as pi hooks in `extension/llama-native/experiments.ts`,
so the policy experiments run on the HTTP provider too (same policy, two transports).

| name | where | what |
|---|---|---|
| `server-cache` | binding | cache like llama-server: re-tokenise the whole prompt, checkpoints only near the prompt end and at the last user message |
| `no-grammar` | binding | no grammar constraint on tool calls (llama-server always applies one when tools are sent) |
| `no-spec` | binding | no speculative decoding |
| `prune` | `context` hook | replace stale tool output (a file read that was later re-read or edited; long command output a few turns old) by a note, in batches, so the cache is edited rarely |
| `done-check` | `agent_before_settle` | when the model stops, ask whether the work is complete and verified (native: on a fork of the cache; HTTP: a 1-token logprob request); if not, nudge and continue (≤ 2) |
| `helper-decide` | `agent_before_settle` | the same decision by a second, small model in the same process |
| `think-route` | `before_provider_request` | after tool results, decide whether the next step is routine; if so, that request runs without thinking |
| `branch-compact` | `session_before_compact` | write pi's compaction summary on a fork of the cached conversation instead of a fresh request that re-reads it |
| `helper-compact` | `session_before_compact` | the summary by the small model from the serialised conversation |

## Benchmark

```bash
scripts/make-pi-agent-copy.sh     # copy of ~/.pi/agent (no sessions) in ~/.cache/native-harness/pi-agent:
                                  # llama.cpp points at our own server, llama-native is linked in
bench/matrix.sh 3                 # baseline + in-process arms, 3 rounds of the main arms
bench/matrix2.sh                  # think-route arms and the long-context session
python3 bench/report.py           # -> results/summary.md
```

- **Tasks** (`bench/tasks/`): six tickets from homelab's `evals/agentic-glimmer-2026-10-14`
  (small git repos with visible tests and hidden tests the agent never sees) plus `bulk-rename`
  (`bench/gen_bulk_rename.py`, a keyword-only API change across a 12-module package).
  `bench/selftest.sh` checks that every broken repo fails and every reference passes.
- **Runner** (`bench/run.py`): copies the repo, runs `pi -p --mode json --model
  <provider>/qwen3.8-27b:medium` with the task, grades with the hidden tests, and records wall
  time, TTFT per request, prompt tokens processed vs reused, generated and drafted tokens, tool
  errors, malformed tool calls and peak VRAM.
- **Long context** (`bench/longctx.py`): one pi RPC session with five prompts that read ~25k
  tokens of files, a manual `/compact`, and a question after it.
- **Isolation**: pi runs on the copy of the human's configuration via `PI_CODING_AGENT_DIR`
  (`scripts/pi.sh`), without the herdr/orca terminal-integration environment so benchmark runs do
  not report themselves as the calling agent. The baseline is our own llama-server on loopback
  (`scripts/baseline-up.sh`, a pass-through proxy in front of it records llama-server's timings),
  never the shared router; `bench/watchdog.sh` stops everything if the router gets a request.
  `scripts/gpu-check.sh` refuses to start a model unless both GPUs are free.

Raw results are in `results/raw/` (one JSONL row per run, plus the pi session, the diff and the
per-request metrics of every run).

## Layout

```
native/        Node-API binding (engine.cpp, service.cpp, addon.cpp, Makefile)
extension/     the pi extension llama-native (provider, experiments, metrics)
configs/       llama-server style argument files (router preset; helper model)
scripts/       baseline server + proxy, pi config copy, pi wrapper, GPU check, smoke test
bench/         tasks, runner, long-context session, matrix scripts, report
results/       raw runs and the generated summary
```
