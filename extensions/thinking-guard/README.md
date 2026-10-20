# thinking-guard

Stops runaway thinking. Local models sometimes think for minutes before they act: turns of
46-58k characters of thinking, such as decoding packet bytes by hand, at 24-27 tok/s. That is where
users give up and abort: 2.4% of local turns are aborted by the user, against 0.6% on cloud models.

thinking-guard caps a reply's thinking and makes the model act instead:

1. **Thinking budget (llama.cpp).** For a llama.cpp server, every request gets a thinking budget
   (`thinking_budget_tokens`, default 3000 tokens: 7-13k characters of thinking, depending on the content) and a short message the
   server inserts when the budget runs out: *"I have deliberated long enough. I stop thinking now
   and act: my next step is a tool call that checks or changes something, or the answer."* The
   server then closes the thinking block and the model goes on to a tool call. Nothing is aborted
   and nothing is re-sent.
2. **Abort and re-issue (fallback).** When a reply's thinking passes 8000 characters (16000 when a
   budget was sent, in case the server ignores it), the reply is aborted and the request issued
   again with a note appended: *"[thinking-guard] Your previous reply was stopped after N characters
   of thinking without an action. Stop deliberating. Take the next concrete step now with a tool
   call…"*. At most 2 aborts per user prompt; after that the model may think as long as it wants.

Both are **append-only**, so the prompt cache of hybrid models (Qwen 3.8 27B) survives: the
budget changes sampling, not the prompt; pi drops aborted replies from the context, so the
re-issued request is the previous one plus the note.

By default only **local models** are guarded: models on loopback or a private network
(10/8, 172.16/12, 192.168/16, 100.64/10, `*.local`, `*.lan`, single-label hosts…).
The budget is only sent where `GET /props` answers like
llama-server (or its router); the result is cached per server.

## Does our llama.cpp honour a per-request thinking budget?

Yes, with the right field name. Checked on the router (llama.cpp `b3411-77c4540ce`, Qwen 3.8 27B,
a "count the primes between 1000 and 1100" prompt):

| request field | thinking | answer |
|---|---:|---|
| none | 9459 chars, still thinking at `max_tokens` 6000 | none |
| `thinking_token_budget: 256` (vLLM's name; pi's `compat.supportsThinkingTokenBudget`) | 7921 chars: **ignored** | 16 (right) |
| `reasoning_budget_tokens: 256` | 550 chars: cut | "7" (wrong, answers at once) |
| `thinking_budget_tokens: 256` + `reasoning_budget_message` | 454 chars: cut, message inserted | keeps working it out in the visible answer |

- llama-server reads `thinking_budget_tokens` or `reasoning_budget_tokens`, plus
  `reasoning_budget_message`, per request (`tools/server/server-common.cpp`). It ignores
  `thinking_token_budget`, the field pi sends with `compat.supportsThinkingTokenBudget: true`.
- pi can send the right field itself (`compat.thinkingTokenBudgetField: "thinking_budget_tokens"`
  in models.json), but then the budget comes from the thinking level and no message is sent. A cut
  without a message makes the model answer immediately, and wrongly in the probe above. With the
  message, in the agent replays below, the model closed its thinking and made a tool call every
  time. So thinking-guard sends both, and keeps a budget pi already set (it only adds the message
  then).

## Settings

Defaults, then `~/.pi/agent/thinking-guard.json` (or the file `PI_THINKING_GUARD_CONFIG` names),
then environment variables:

| key | env | default | |
|---|---|---|---|
| `enabled` | `PI_THINKING_GUARD_ENABLED` | `true` | |
| `scope` | `PI_THINKING_GUARD_SCOPE` | `"local"` | `"all"` guards cloud models too (abort only; no budget for them) |
| `maxThinkingChars` | `PI_THINKING_GUARD_MAX_CHARS` | `8000` | abort past this without a budget; `0` disables the abort |
| `budget` | `PI_THINKING_GUARD_BUDGET` | `"auto"` | `"auto"`: llama.cpp servers; `"on"`: every guarded `openai-completions` model; `"off"` |
| `budgetTokens` | `PI_THINKING_GUARD_BUDGET_TOKENS` | `3000` | local Qwen thinking averages ~2.7 chars/token (2.2-4 in the replays below) |
| `budgetField` | | `"thinking_budget_tokens"` | |
| `budgetMessage` | | see above | inserted by llama.cpp when the budget runs out |
| `fallbackChars` | `PI_THINKING_GUARD_FALLBACK_CHARS` | `16000` | abort threshold when a budget was sent |
| `maxRetries` | `PI_THINKING_GUARD_MAX_RETRIES` | `2` | aborts per user prompt |
| `note` | | see above | appended after an abort; `{chars}` is replaced |

`/thinking-guard` shows the settings, whether the current model is guarded and gets a budget, and
what the guard did in this session; `/thinking-guard off` and `on` toggle it for the session. Every
abort and budget stop is recorded in the session as a `thinking-guard` custom entry (not sent to
the model).

## Results

Measured 2026-10-18/19. **Cloud runs are complete. The local runs are the first ones on the 27B
only**; the rest were skipped by the owner (see [Local: not measured](#local-not-measured-skipped-by-the-owner)).
The llama.cpp router was shared with three other benchmark campaigns while these ran.

**In short:**

- **Local 27B, real runaway turns replayed:** on the four longest thinking turns in the local pi
  sessions (38-58k characters), the budget cut thinking from 13.7-56.1k to 6.8-12.7k characters, and
  every guarded reply went on to a tool call. The 58k case reproduced at 56k characters (26k tokens,
  9 min) without the guard and stopped at 9.1k characters (3 min) with it.
- **Prompt cache (local 27B):** a request with the budget reused 16,404 of its 16,408 prompt tokens.
  The guard's re-issue (the same request plus the note) reused 16,404 tokens and processed only the
  80-token note.
- **Cloud, guard on for all models (`scope: "all"`):** DeepSeek Flash thought past 8k characters in
  4 of 30 runs without the guard (up to 14.9k). With the guard, it was aborted 4 times in 30 runs.
  Every aborted reply was followed by a tool call, and all 4 runs passed. Pass rate 29/30 vs 28/30;
  the failures are wrong checksums on `pcap-decode`, with no abort in those runs. Claude Sonnet 5.5
  never thought past 560 characters, so the guard never fired; that pair (15/15 vs 14/15, the miss
  again a `pcap-decode` checksum) only shows the guard is harmless there.
- **Not measured yet:** the effect on user aborts (2.4% of local turns). That needs real use over a
  few days, then the session scan again.

### Local 27B: real runaway turns, replayed

[`capture.ts`](bench/capture.ts) rebuilt the exact request pi sent before each of the four longest
local thinking turns. [`replay.ts`](bench/replay.ts) then sent it to Qwen 3.8 27B as it was ("off")
and with the guard's budget fields added ("on"). Two of the four original turns were the ones the
user aborted.

| case (original turn) | original thinking | off: thinking → action | on: thinking → action | budget hit |
|---|---:|---|---|:-:|
| 27B, pcap decoder rewrite (`wifi-336`) | 58,226 | 34,211 → read (317 s) | 6,759 → read (89 s) | yes |
| same, re-run on `replay.ts` | | 56,076 → read (540 s) | 9,144 → read (174 s) | no¹ |
| 27B, same session later, aborted by the user (`wifi-355`) | 46,227 | 31,677 → edit (326 s) | 12,665 → bash (340 s²) | yes |
| Flash-Next session on the 27B (`games-15`) | 46,391 | 13,654 → bash (221 s) | 10,879 → bash (197 s) | yes |
| Flash-Next session on the 27B, aborted by the user (`games-69`) | 38,164 | 23,294 → write (688 s) | 12,000 → bash (239 s) | yes |

All numbers are characters of thinking in one reply; wall times include queueing behind the other
campaigns on the router. The first rows of each case come from an earlier Python prototype of
`replay.ts` (since removed). It sent the same requests with the same added fields; only the
`wifi-336` re-run is from `replay.ts` itself. The others were not re-run on `replay.ts`.
¹ the model ended its thinking on its own at about 2,200 tokens, just under the budget.
² the guarded request re-read its whole 60k-token prompt: another campaign had evicted the slot.

### Local 27B: prompt cache

`replay.ts cache` on the `games-15` request (16,408 prompt tokens), back to back. This first trial
also ran on the Python prototype; there were no trials on `replay.ts`.

| step | prompt tokens processed | reused |
|---|---:|---:|
| warm-up, with budget | 16,408 | 0 |
| same request again, with budget | 4 | 16,404 |
| without budget (the abort step; this time the reply ended at 6.1k characters, before the abort) | 4 | 16,404 |
| re-issue: same request + the guard's note | 80 | 16,404 |

In a real pi run on the bench (`log-stats` on the 27B, guard on, interrupted when the router was
taken offline), all 16 requests carried `thinking_budget_tokens: 3000`. Prompt reuse was normal
(e.g. 20,157 of 20,199 tokens) except right after another campaign's request had taken the slot.

### Cloud (`node bench/run.ts --report A B`, same tickets and rounds in both arms)

| arm | runs | passed | wall (median) | thinking chars/turn p50 / p90 / max | completed turns >8k | guard aborts | tool errors | output tokens |
|---|---:|---:|---:|---|---:|---:|---:|---:|
| DeepSeek Flash, guard off | 30 | 28 | 27 s | 438 / 2827 / 14922 | 4 | 0 | 30 | 154,456 |
| DeepSeek Flash, guard on (`scope: "all"`) | 30 | 29 | 26 s | 358 / 2758 / 8009³ | 0 | 4 | 42 | 141,437 |
| Claude Sonnet 5.5, guard off | 15 | 15 | 15 s | 0 / 105 / 413 | 0 | 0 | 4 | 23,533 |
| Claude Sonnet 5.5, guard on (`scope: "all"`) | 15 | 14 | 14 s | 0 / 208 / 560 | 0 | 0 | 5 | 24,364 |

³ the aborted partial replies (8,006-8,009 characters). DeepSeek Flash: 5 tickets × 6 rounds;
Sonnet: 5 tickets × 3 rounds. In each of the 4 aborted runs (`event-reconcile` 3×, `log-stats`), the
reply after the note thought for 0.9-3.1k characters and called a tool (bash or write), and the
ticket passed. Tool errors are mostly failing test or command runs during the work (24 of 35 off,
32 of 46 on); the difference is within run-to-run noise.
Raw rows: [`bench/results/`](bench/results/).

### Local: not measured (skipped by the owner)

The local agent tickets, the replays on `replay.ts` and the prompt-cache trials planned for HRN-13
were **not run**. The owner skipped them on 2026-10-20 because the local model now in use, Swift 1.5
Qwen3.8-Flash-Next IQ3_S on Strata (`strata/swift-1.5-flash-next-iq3_s`), already passes these
kinds of tickets in the other extensions' local runs:
- verify-gate: 42 of 44 runs passed, including `event-reconcile` 4/4, `logstats` 3/4 and
  `ttlcache` 4/4.
- loop-guard: 10/10 tickets, including `event-reconcile` 2/2 and `logstats` 2/2.
- local-edit: 6/6.

So the local numbers above are still the 27B's, from the first, partly shared-router runs.

One thing was checked on Strata (a single request, 2026-10-20): **Strata ignores
`thinking_budget_tokens`.** With and without the field, the reply thought for about 3,300 tokens
and stopped on Strata's own cap ("I have thought about this long enough"). On Strata, then, only
the guard's abort-and-re-issue path can act; the budget does nothing there.

Still open, and needing real use rather than a bench: the share of user-aborted turns (2.4 %
before) after a few days of local use with the guard on.

## Benchmark

Everything is TypeScript on pi's own APIs (no Python), under [`bench/`](bench/):

- [`run.ts`](bench/run.ts) drives pi in-process through its SDK (`createAgentSession`) with a copy
  of your config (`~/.pi/agent`, never edited in place), works the tickets in
  [`bench/tasks/`](bench/tasks/) with or without the extension, and grades each final tree with the
  ticket's hidden test (node's test runner). Models on a private network go through a logging proxy
  that records llama-server's timings per request.
  `node bench/run.ts ARM --model PROVIDER/ID [--guard on] [--set budget=off] [--rounds N]`;
  `node bench/run.ts --report ARM...` compares arms on the ticket/round pairs they all have.
- Tickets (TypeScript repos, hidden tests, reference solutions): `pcap-decode` (decode a hex dump
  and check its checksums: the kind of work the 58k-character turn did by hand), `interval-sweep`,
  `event-reconcile`, `ttl-cache`, `log-stats`. [`tasks.test.ts`](bench/tasks.test.ts) checks that
  every hidden test fails on the repo as given and passes with the reference.
- [`capture.ts`](bench/capture.ts) rebuilds, with pi's SDK, the exact request pi sent at a point in
  one of your sessions; [`replay.ts`](bench/replay.ts) `replay` sends such requests with and without
  the budget, and `replay.ts cache` checks prompt-cache reuse for the budget and for an abort followed
  by the guard's re-issue.
