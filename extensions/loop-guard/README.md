# loop-guard

Catches a model that keeps doing the same failing thing, or that stops talking before it acts,
and tells it so in one short line. Made for local models (Qwen 3.8 27B on llama.cpp), harmless on
cloud ones.

| rule | fires when | what the model gets |
|---|---|---|
| **retry** | a tool call fails exactly as an earlier call with the same arguments did (within the last 20 calls) | a note at the end of that tool result: "This exact `edit` call has now failed 2 times with the same error … Change approach: *(what to try for this tool)*" |
| **repeat** | the same call succeeds with the same output for the 3rd, 5th, 8th, 12th time | a note: running it again will not tell you anything new |
| **streak** | the last 3 (6, 9…) tool calls all failed, whatever they were | a note: stop and rethink, take one small verifiable step |
| **stall** | the run ends on a message with no tool call whose last sentence announces an action ("Let me fix the parser.", "I'll run the tests now.") | one more turn, with a message: you said you would …, but made no tool call; do it now, or say plainly that the work is finished (at most 2 per prompt) |

"Same arguments" means equal after sorting keys; a shell `command` also ignores whitespace and
output plumbing (`2>&1`, a trailing `| tail -20`). Edit and write texts must match exactly, so an
edit that only fixed its indentation is a new attempt. "Same error" ignores numbers (timings,
line counts) and whitespace.

Offers and wrap-ups are not stalls: "Let me know if…", "say the word and I'll…", "I'll report
back when the job finishes", "I should note that…", a question to the user, and so on.

## Prompt cache: append only

Qwen 3.8 is a hybrid (Gated DeltaNet) model: llama.cpp cannot reuse a cached prompt past the
first changed message, so any extension that edits earlier messages makes every later request
re-read the whole conversation (60–95 s per turn on the 27B). loop-guard never edits history:

- a note is added to the **newest** tool result, in pi's `message_end` event, before pi saves it
  or sends it; earlier messages are untouched, and the next request is a strict extension of the
  previous one. `message_end` also sees the results of calls pi rejects before running them
  (bad arguments, unknown tool), which the `tool_result` event does not;
- a stall nudge is a new message after the last one, added in `agent_before_settle` with one
  continuation.

The smoke test (`loop-guard.smoke.mjs`) checks this in a real `pi -p` run: the first failure's
result reaches the model unchanged, the second carries the note, and the nudge request ends with
the unchanged answer followed by the nudge.

## Settings

All rules are on by default. `PI_LOOP_GUARD=off` turns them all off; `PI_LOOP_GUARD=-stall,-repeat`
turns single rules off. `/loop-guard` shows how often each rule fired in the session. To unload
the extension, see [enable and disable extensions](../../README.md#enable-and-disable-extensions).

Not covered: calls made from inside a codemode script (pi's nested calls) are not tool results of
the conversation; the codemode call itself is tracked like any other call.

## Results

Short version, measured 2026-10-18/19:

- **The problem is real but rare.** In 658 recorded sessions, the local models retried a failed
  call identically and failed the same way 4 times in 4 537 calls (cloud: 14 in 60 280). The
  stall rule matches 2 local endings in 4 573 turns. Most "exact retries" in the old sessions are
  OMP's hashline protocol working as designed (the first edit fails and shows the lines, the
  identical retry succeeds), and most local "I'll …" endings are offers to the user. loop-guard
  stays quiet on both.
- **On cloud models it costs nothing.** Sonnet 5.5 passes 27/27 tickets with and without it;
  DeepSeek Flash 27/27 without and 26/27 with, and the guard did nothing in the failed run. The
  guard fired no note and no nudge in any normal ticket run.
- **When the situation is forced (injection), the stall nudge rescues every run.** Without it the
  run ends with the work undone (0/5); with it the model goes on and passes (5/5). The retry note
  fires every time, but DeepSeek never repeated the failed call even without it, so on cloud there
  was no blind retry for it to prevent.
- **The local 27B, the model this is for, is not measured yet** (see "Local 27B: pending").

### Recorded sessions (replay)

`node extensions/loop-guard/bench/replay.ts ~/.pi/agent/sessions ~/.omp/agent/sessions` replays every
recorded pi and OMP session through the rules (no model). "Exact retry" is the metric of the
2026-10-12 analysis: the call repeats the previous one byte for byte and that one failed.

| metric | local | cloud |
|---|---:|---:|
| sessions | 94 | 568 |
| assistant turns | 4573 | 51735 |
| tool calls | 4537 | 60280 |
| tool error rate | 8.71 % | 5.28 % |
| exact retry of a failed call | 16 (0.35 %) | 105 (0.17 %) |
| rule retry would fire | 4 (0.09 %) | 14 (0.02 %) |
| &nbsp;&nbsp;next call the same again (a third blind try) | 1 of 4 | 1 of 14 |
| rule repeat would fire | 0 (0.00 %) | 47 (0.08 %) |
| rule streak would fire | 14 (0.31 %) | 80 (0.13 %) |
| run-ending messages | 296 | 2167 |
| stall rule would fire | 2 (0.04 % of turns) | 2 (0.00 % of turns) |
| &nbsp;&nbsp;user then said "go on" | 0 of 2 | 0 of 2 |
| &nbsp;&nbsp;"go on" after other endings | 1 of 294 | 51 of 2165 |

The session set grew since the 2026-10-12 analysis (1.4 % / 0.4 % exact retries there, counted
per turn on a smaller set). 12 of the 16 local exact retries are OMP hashline edits whose retry
succeeded; the retry rule fires only when the retry fails the same way.

### Tickets, before and after

`bench/run.ts` drives pi in-process through its SDK (`createAgentSession`) on a copy of the pi
config, with the default tools (read, bash, edit, write). Each ticket runs once without and once
with loop-guard per round. Nine TypeScript tickets in `bench/tasks/`: six regular ones (logstats,
ttlcache, cli-json, bulk-rename from `experimental/llama-native/bench`; event-reconcile and
schedule-repair from the homelab capability suite), and three traps whose obvious first call fails
(stale-paths: the issue names a path and a test command that do not exist; twin-blocks: the text to
replace appears twice; no-exec: the test script has no exec bit). Hidden `node:test` tests grade the
final tree; `bench/selftest.ts` (part of `scripts/check.sh`) checks that every starting tree fails
them and a reference fix passes.

### deepseek-flash (9 tickets, 3 rounds)

| | without loop-guard | with loop-guard |
|---|---:|---:|
| runs | 27 | 27 |
| passed | 27/27 | 26/27 |
| tool calls / run | 8.0 | 7.1 |
| tool error rate | 5.6 % | 6.7 % |
| exact retry of a failed call | 0 (0.0 %) | 0 (0.0 %) |
| notes: retry / repeat / streak | 0 / 0 / 0 | 0 / 0 / 0 |
| runs ending on a stall | 0 | 0 |
| stall nudges sent | 0 | 0 |
| timeouts | 0 | 0 |
| median wall time | 17 s | 14 s |

Passed per ticket (without / with): bulk-rename 3/2, cli-json 3/3, event-reconcile 3/3, logstats 3/3, no-exec 3/3, schedule-repair 3/3, stale-paths 3/3, ttlcache 3/3, twin-blocks 3/3.

The one failed run (bulk-rename, with loop-guard) got no note and no nudge: loop-guard did not act in it, so it is the model's own run-to-run variance.

### claude-sonnet-5-5 (9 tickets, 3 rounds)

| | without loop-guard | with loop-guard |
|---|---:|---:|
| runs | 27 | 27 |
| passed | 27/27 | 27/27 |
| tool calls / run | 2.8 | 2.9 |
| tool error rate | 13.3 % | 14.1 % |
| exact retry of a failed call | 0 (0.0 %) | 0 (0.0 %) |
| notes: retry / repeat / streak | 0 / 0 / 0 | 0 / 0 / 0 |
| runs ending on a stall | 0 | 0 |
| stall nudges sent | 0 | 0 |
| timeouts | 0 | 0 |
| median wall time | 11 s | 11 s |

The error rate comes from the traps: their first obvious call fails by design.

### Injection: forcing a blind retry or a stall

Because the tickets rarely make a model retry blindly, `bench/run.ts --inject` forces the situation
and then lets the real model take over. pi talks to a small proxy inside the runner that answers
the first requests from a script and forwards the rest to the real provider:

- `retry-read`, `retry-bash`, `retry-edit`: the same failing call twice (read a path that does not
  exist, run `./run_tests.sh` without the exec bit, an edit whose text appears twice). pi really runs
  both calls, so the failures and loop-guard's note are real;
- `stall`: one `ls -R`, then an answer that ends "Let me read it and fix both bugs." with no tool call.

"Model's first call repeats" counts runs where the model's first own call is the injected call a
third time.

### inject-deepseek-flash (5 rounds per scenario and arm)

| scenario | loop-guard | passed | model's first call repeats the failed call | identical repeats in all | model turns (median) | notes / nudges |
|---|---|---:|---:|---:|---:|---:|
| retry-bash | without | 5/5 | 0/5 | 0 | 6 | 0 / 0 |
| retry-bash | with | 5/5 | 0/5 | 0 | 6 | 5 / 0 |
| retry-edit | without | 5/5 | 0/5 | 0 | 4 | 0 / 0 |
| retry-edit | with | 5/5 | 0/5 | 0 | 5 | 5 / 0 |
| retry-read | without | 5/5 | 0/5 | 0 | 8 | 0 / 0 |
| retry-read | with | 5/5 | 0/5 | 0 | 9 | 5 / 0 |
| stall | without | 0/5 | - | - | 0 | 0 / 0 |
| stall | with | 5/5 | - | - | 5 | 0 / 5 |

Anthropic models cannot go through the proxy (it speaks the OpenAI chat-completions API), so the
injection runs on cloud use DeepSeek Flash only.

### Local 27B: pending

**Not measured yet.** The local runs were stopped on 2026-10-19 because the machine is lent to
another trial (the llama.cpp router is down and its GPUs are taken), so no local numbers are in this
README. A separate task runs them afterwards. Still to do, on `llama.cpp/qwen3.8-27b` through the
router, thinking `medium`, one run at a time:

1. Injection, 3 rounds × 4 scenarios × 2 arms = 24 runs:
   `node extensions/loop-guard/bench/run.ts --model llama.cpp/qwen3.8-27b --thinking medium --label inject-qwen3.8-27b --inject retry-read,retry-bash,retry-edit,stall --rounds 3`
2. Tickets, 3 rounds × 9 tickets × 2 arms = 54 runs:
   `node extensions/loop-guard/bench/run.ts --model llama.cpp/qwen3.8-27b --thinking medium --label qwen3.8-27b --rounds 3`
3. `node extensions/loop-guard/bench/report.ts inject-qwen3.8-27b qwen3.8-27b` and replace this
   section with the two tables.

Each command resumes where it stopped and reruns runs that ended on a provider error; run it a
second time after it finishes. A 27B run took about 6 minutes while other benchmarks shared the
router.

### Reproduce

```bash
node extensions/loop-guard/bench/replay.ts ~/.pi/agent/sessions ~/.omp/agent/sessions
node extensions/loop-guard/bench/selftest.ts
node extensions/loop-guard/bench/run.ts --model deepseek/deepseek-flash --rounds 3
node extensions/loop-guard/bench/run.ts --model deepseek/deepseek-flash --inject retry-read,retry-bash,retry-edit,stall --rounds 5
node extensions/loop-guard/bench/report.ts
```

Results land in `bench/results/<label>.jsonl` (one row per run); sessions, work trees and the
config copy in `~/.cache/pi-extras/loop-guard/`. The per-extension bench is meant to be replaced by
the shared SDK bench of HRN-10.

## Files

- `index.ts`: the pi wiring (events, command); `guard.ts`: the rules and wording, no pi;
- `guard.test.ts`, `index.test.ts`: unit tests; `loop-guard.smoke.mjs`: headless pi run on a mock model;
- `bench/run.ts`: before/after and injection runs on pi's SDK; `bench/report.ts`: the tables above;
- `bench/replay.ts`: replays recorded sessions through the rules; `bench/lib.ts`: tickets, grading, config copy;
- `bench/tasks/`: the TypeScript tickets; `bench/selftest.ts`: checks them; `bench/results/`: one row per run.
