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

RESULTS_PLACEHOLDER

## Files

- `index.ts`: the pi wiring (events, command); `guard.ts`: the rules and wording, no pi;
- `guard.test.ts`, `index.test.ts`: unit tests; `loop-guard.smoke.mjs`: headless pi run on a mock model;
- `bench/replay.mjs`: replays recorded pi / OMP sessions through the rules;
- `bench/run.py`: before/after runs on coding tickets; `bench/tasks/`: the trap tickets;
- `bench/inject.py`: the injection experiment; `bench/report.py`: the tables below from `bench/results/`.
