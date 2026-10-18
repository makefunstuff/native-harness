# Results

Short version: **it works, but it is not faster or cheaper.** llama.cpp runs inside pi's own
process as one more model provider, and pi works the same tickets with all its tools and
extensions. The kernels are the same, so decode and prefill speeds are the same. llama-server's
prompt cache already reuses 92% of the prompt in an agent loop. The one measured in-process gain
is a cheaper rewind after editing old context (29% fewer tokens re-read in one micro-benchmark).
On this hybrid model that gain is capped. Not worth going on with as "the native approach" in its
current form; see "Next steps".

The benchmark was stopped early at the owner's request: 83 ticket runs (including one partial
`native+no-spec` round, 6 of its 7 tickets) plus one context-edit micro-benchmark. Several
experiments did not run. The data is thin (1-3 runs per task and arm); differences in pass rate or
wall time below are within noise unless stated otherwise.

## Setup in one paragraph

Model: Qwen3.8-27B QUASAR NVFP4 with the DFlash2 drafter and n-gram speculation, the router's
`[qwen3.8-27b]` preset unchanged (`configs/qwen3.8-27b.args`), on the router's llama.cpp build.
Harness: the human's pi 1.3.0 with its full configuration (tools incl. codemode, web and memory,
extensions, skills, MCP), run on a copy of `~/.pi/agent`.
- Baseline `http`: pi's `llama.cpp` provider → our own llama-server on loopback.
- In-process `native`: pi's `llama-native` provider, the same OpenAI-completions client with an
  in-process `fetch` → Node-API binding of libllama (`native/`, `extension/`).

Tickets: the six from homelab `evals/agentic-glimmer-2026-10-14` plus a 12-module API rename,
graded by hidden tests, `:medium` thinking. Raw data: `results/raw/*.jsonl` and `results/raw-artifacts.tar.xz`, tables:
`results/summary.md`, `results/uncertainty.md`, `results/microbench/`.

## Does it work end to end?

Yes. 18/21 in-process runs passed against 16/21 over HTTP. Every in-process run completed with no
provider errors and no malformed tool calls. Tools, codemode, memory/web tools and the other
extensions behaved as on HTTP.

| | http | native |
|---|---|---|
| tickets passed | 16/21 | 18/21 |
| presets-ini (ambiguous `argv` spec, known from homelab) | 0/3 | 1/3 |
| other failures | config-rename 1, sqlite-migration 1, ttlcache 0 (1 timeout, still passed) | sqlite-migration 1 (grading failed: `/tmp` out of inodes, could not be re-graded) |

The pass-rate difference is not meaningful at n = 21.

## Is it faster or cheaper?

No. Same speed where the work is the same; slightly slower per turn because of the binding's own
bookkeeping; plus a model load per pi process.

| measure (main arms, 21 runs each) | http | native |
|---|---|---|
| decode, tok/s (incl. speculation) | 76.5 | 75.6 |
| draft acceptance | 0.37 | 0.37 |
| prefill, tok/s | 830 | 847 |
| prompt tokens reused from cache | 92.4% | 92.3% |
| prompt tokens re-fed after a rewind | – | 0 |
| TTFT, first request (≈4.7k-token cold prompt), median | 5.0 s | 4.5 s |
| TTFT, turns with < 300 new prompt tokens, median | 281 ms | 453 ms |
| model load per pi process, median / max | 0 (server stays up) | 12.5 s / 84 s |
| generated tokens per task, median | 2684 | 3706 |
| sum over the 7 tasks of the median wall time per task (excl. load and timeouts) | 530 s | 654 s |
| peak VRAM GPU0 / GPU1 | 12.5 / 13.0 GB | 13.1 / 13.6 GB |

- **Prefix reuse is already solved over HTTP for an append-only loop.** pi sends append-only
  transcripts (`preserve_thinking`), and llama-server checkpoints near the end of every prompt, so
  each turn re-reads only the new tool output. The binding does the same, with no advantage.
- **The binding adds ~170 ms per turn.** It renders the chat template once per message to find
  message boundaries (median 46 ms) and saves a 150 MB recurrent-state checkpoint at each
  boundary. HTTP and JSON cost almost nothing next to that.
- **The per-process model load hurts one-shot `pi -p` use.** It took 4-84 s, depending on whether
  the 17 GB of weights were still in the page cache; this host has little free RAM. An
  interactive session pays it once.
- **More generated tokens in-process: unexplained, possibly noise.** The native arm generated
  more tokens than HTTP on 6 of 7 tasks, which explains most of the wall-time gap. The
  `native+server-cache` arm, which re-tokenises the prompt like the server, did not (1 run per
  task). One candidate cause is that the binding feeds the model its own exact earlier tokens
  instead of the re-tokenised rendering. The data is too thin to tell.

## Which experiments showed an effect

| experiment | runs | result |
|---|---|---|
| speculative decoding off (`no-spec`) | 6 native | **Real and large:** decode 34.6 vs 75.6 tok/s; wall time up on 5 of 6 tasks (logstats 94 vs 45 s, sqlite-migration 274 vs 170 s). llama-server has the same drafter, so this is not an in-process advantage. |
| tool-call grammar off (`no-grammar`) | 14 native | **No effect:** 0 malformed tool calls with or without the grammar. In every arm and run, Qwen3.8 never produced a malformed call on these tasks. |
| cache like llama-server (`server-cache`) | 7 native | Same reuse as the segment cache; n = 1 per task. |
| KV edit / prune (`prune`, `context` hook) | 7 http | **Never triggered:** stale output in these short tickets (max prompt ~25k) stayed below the batch threshold. Not run in-process. |
| context-edit micro-benchmark | 1 per path | **Small win for in-process edits, capped by the model** — see below |
| done-check decision (`agent_before_settle`) | 7 http | **No effect:** the model rated its own work "done and verified" at p ≥ 0.994 every time, including on a failed ticket, so it never nudged. Each decision cost ~0.4 s over HTTP (76 new tokens; the prefix came from the cache). Not run in-process. |
| entropy as an uncertainty trigger | 476 turns, 48 native runs | **No signal:** entropy of the tool-call part does not predict a failing tool result (ROC AUC 0.52); whole-turn entropy is weak (0.61). Per task it does not predict a failed ticket (0.37-0.63, 6 failures). Forks for "hard steps" were not built on it. |
| helper model (`helper-decide`, `helper-compact`), `think-route`, compaction on a fork (`branch-compact`), long-context session, "HTTP done well" ticket arm | 0 | **Not run** (stopped). The code is in place: `extension/experiments.ts`, `bench/longctx.py`, `bench/matrix2.sh`. |

### Context-edit micro-benchmark (`bench/edit-microbench.mjs`, `results/microbench/`)

A 23k-token conversation (8 tool results of ~3k tokens). The result of call 3 is replaced by a
one-line note; then a normal append; then the edit is undone.

| | native | http (preset) | http-tuned (`--checkpoint-min-step 0`, `--ctx-checkpoints 64`, `--cache-reuse 256`, `--cache-ram 16384`) |
|---|---|---|---|
| replace an old tool output: tokens re-processed / time | 14,308 / 14.5 s | 20,086 / 19.0 s | 20,086 / 19.1 s |
| normal append of one tool result | 549 / 0.93 s | 551 / 0.82 s | 551 / 0.80 s |
| undo the edit (original text back) | 17,156 / 17.4 s | 4 / 2.2 s | 4 / 1.1 s |

- **In-process edits rewind to the edited message.** The binding keeps a checkpoint at every
  message boundary. llama-server only has checkpoints near the end of each earlier prompt and at
  user-message starts, so it falls back almost to the start (464 tokens kept).
- **Everything after the edit is re-read either way.** Qwen3.8 is a hybrid Gated-DeltaNet model:
  its recurrent layers cannot drop or shift tokens in the middle of the context. The KV cache
  cannot be "edited" here, only rewound to a saved state of the recurrent layers (~150 MB each,
  host RAM) and recomputed from that point. The server log confirms `cache_reuse is not supported
  by this context` (KV shifting, llama.cpp discussion #13606), and the particula.tech note on
  SWA/hybrid reprocessing describes the same limit. Roll-back without a snapshot works only for
  the last 7 tokens (`n_rs_seq`, used by speculative decoding).
- **llama-server's host prompt cache wins when the edit is undone:** it stored the earlier full
  state; the binding has no such cache.
- **"HTTP done well" made no difference here.** `--checkpoint-min-step 0` adds checkpoints at user
  messages only, and the tool results sit after the one user message. Slot save/restore (#20572)
  helps resumed sessions, which these runs do not have.

## Is it worth going on with?

Not as a replacement for pi → llama-server over HTTP. In an append-only agent loop the in-process
path has nothing to win: same kernels, same cache reuse, and llama-server's checkpoints already
cover it. The binding's extra work makes each turn slightly slower. The ideas that need
in-process access did not pay off on this model and these tasks:
- KV editing is rewind-and-recompute on a hybrid model.
- The model's self-assessment is uninformative as a decision signal.
- Entropy does not flag bad steps.
- The tool-call grammar is never needed.

What stays useful:
- the provider itself — pi works on an in-process model with no changes to pi;
- per-message checkpoints (a real but bounded gain for history edits);
- forks of the cached conversation — a decision costs 0.26 s in the smoke test and touches
  nothing in the main sequence.

The idea would matter more with a pure-attention model (true `seq_rm`, edits without
recomputation), long sessions that compact, or several requests that share a cache.

## Next steps (if any)

1. **Measure the one promising untested lever: compaction on a fork.** pi's `/compact` sends the
   whole transcript as a new prompt, a full cold prefill of ~100k tokens at ~850 tok/s. Writing
   the summary on a fork of the cached conversation needs none of that. `bench/longctx.py` with
   `branch-compact` vs `http`, 2 runs each, answers it in about an hour.
2. **If it pays, put it where it is cheap to keep: llama-server, not a binding.** Add checkpoints
   at every message boundary as a server option, and a "fork this slot for one request" mode for
   decisions and summaries. That brings the edit and fork gains to every client, with no
   per-process model load and no second copy of the cache logic.
3. **Otherwise, stop here.** Keep `experimental/llama-native/extension` as an optional in-process model for
   offline or single-user use. Fix its per-turn overhead first: cache the per-message renders,
   checkpoint only before tool results.

## Related work

- mozilla-ai/agent.cpp: a C++ agent loop on in-process llama.cpp, with message-level callbacks
  rather than KV-level control; the nearest existing project.
- llama-cpp-agent: GBNF grammars for always-valid tool calls; here the grammar was never needed.
- vk-ai/agent-harness-bench: a template for repeatable harness benchmarks with confidence
  intervals, which this one lacks (too few runs).
- Prefix-tree reuse and forks (SGLang/RadixAttention), pinning KV during tool calls (Continuum),
  order-invariant caching of tool and skill schemas (ReCache, CacheScout), KVFlow, persistent Q4
  KV for agents: all assume attention-only KV that can be shared or edited. On Qwen3.8's hybrid
  layers they reduce to state snapshots plus recomputation.
- Token-level control in the same process (guidance, LMQL) and entropy-driven sampling
  (Entropix): the entropy trigger was tested here as a predictor and showed no signal for tool
  errors.
