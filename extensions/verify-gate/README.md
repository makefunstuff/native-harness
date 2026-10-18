# verify-gate

Runs the project's check before the agent may say it is done. When the agent changed files during
a prompt and is about to stop, verify-gate runs the check command. If the check fails, the agent
gets the output and works one more round, at most two rounds per prompt. It also adds one line to
the system prompt so the agent writes tests that are independent of the code:

> Tests must not share assumptions with the code under test: derive expected values from the task
> or spec (or by hand), never from running or copying the implementation.

What it targets: "All done, make test passes" when the tests were written from the same wrong
assumption as the code, or were never run after the last edit (failure #4 in the local-model
session analysis).

## The check command

It looks from the working directory up to the repository root. In each folder it checks
`.pi/verify` first, then `AGENTS.md`:

- **`.pi/verify`**: a shell script. Executable files are run as they are; other files are run
  with `bash`. It runs in the folder that holds `.pi/`. For example:
  ```sh
  python3 -m unittest discover -s tests
  ```
- **`AGENTS.md`**, in one of three explicit forms. Prose is never read for commands, so the gate
  only runs a command someone wrote down for it:
  ```markdown
  <!-- verify: make test -->
  Verify: `npm test`             (also "Check:", "Check command:", bulleted or bold)
  ## Verify                      (also "Check", "Checks"): the first code block of that section
  ```

With no command found, the extension does nothing except add the prompt line. It also does not
run the check in a project that pi does not trust (`--no-approve`, or a declined trust prompt).
The check comes from the project, just like `.pi/extensions`.

## When it runs

- Only at `agent_before_settle` with outcome `completed`, so not after an abort or an error. It
  also waits when another extension already asked to continue.
- Only after files changed since the last check: a successful `edit` / `write` call (codemode's
  nested calls count too), or a change in the git working tree. That covers files written through
  `bash` as well. `__pycache__`, `.pytest_cache` and `node_modules` are ignored. Changes the user
  makes between prompts do not count.
- On failure it appends the output (the head and the tail, 4 000 characters) as a message and
  returns `continue: true`. The message asks the agent to fix the cause, not weaken the tests, and
  to say so plainly if the failure is not its doing. After `PI_VERIFY_ROUNDS` rounds it stops and
  appends a visible "still fails" note. Every check is recorded as a `verify-gate` custom session
  entry (result, exit code, time). The model does not see these entries.
- **Prompt cache.** Everything is appended at the end of the session; no message in the history is
  ever rewritten. The prompt line is the same in every run, so the system prompt never changes
  between requests. That matters on hybrid models such as Qwen3.8, which must re-read the whole
  prompt after any change in the history. The smoke test checks that each request starts with the
  previous one.

`/verify` runs the check by hand and shows the result.

| environment | default | |
|---|---|---|
| `PI_VERIFY_GATE` | `on` | `off`, `gate-only` (no prompt line), `rule-only` (prompt line only) |
| `PI_VERIFY_ROUNDS` | `2` | rounds of fixes per prompt |
| `PI_VERIFY_TIMEOUT` | `300` | seconds before the check is killed (counts as a failure) |
| `PI_VERIFY_MAX_OUTPUT` | `4000` | characters of output given to the model |

The check gets `PI_VERIFY_GATE_ROUND` (0, 1, 2…) in its environment.

## Measured

Bench: pi 1.3.0 driven in-process through its SDK (`bench/run.ts`). It runs on a copy of the
owner's pi config: settings, models, global extensions, codemode and tool search, but no MCP.
There are nine TypeScript tickets in `bench/tickets/`, each graded by hidden `node:test` tests the
agent never sees. Every ticket repo has a `.pi/verify` file, so the gate checks the project's own
check. That check is the agent's own tests, plus a changelog rule in the `duration` ticket
(written in that repo's AGENTS.md). Both arms get the same repos; the "gate" arm loads
verify-gate (the gate plus the prompt line). Three rounds per arm, run 2026-10-19
(`bench/run-all.sh NAME MODEL 3`):

| arm | runs | hidden tests pass | own check green, hidden tests red | gate sent the agent back | mean wall s | mean tool calls |
|---|---|---|---|---|---|---|
| claude-sonnet-5-5, no gate | 27 | 27/27 | 0 | – | 12.6 | 2.2 |
| claude-sonnet-5-5, verify-gate | 27 | 27/27 | 0 | 0 of 27 checks failed | 12.6 | 2.3 |
| deepseek-flash, no gate | 27 | 27/27 | 0 | – | 18.7 | 6.9 |
| deepseek-flash, verify-gate | 27 | 26/27 | 1 (api-migration) | 0 of 27 checks failed | 20.1 | 7.1 |

Full tables: [`bench/results/summary.md`](bench/results/summary.md).

What this shows, and what it does not:

- **No gain on cloud models, which is expected.** Both cloud models always run the project's
  check before they finish, so in 54 gated runs the check never failed and the gate never sent
  an agent back. Its cost is one run of the check per prompt: +0 s on Claude, +1.4 s on
  DeepSeek (within noise).
- **The prompt line did not stop self-confirming tests.** The one miss in the gated runs was
  DeepSeek on api-migration: its own tests passed, but `call(url, null)` sent 0 ms instead of the
  default 30 000. Its tests had the same blind spot as its code. That is the failure this
  extension targets, and the gate cannot catch it when the agent's own tests are green. One miss
  in 27 runs, against 0 in 27 without the extension, is noise, not evidence of harm.
- The gate is aimed at local models, which in the session analysis stop with "All done" more
  often. That measurement is still pending (next section). The behaviour is covered by the unit
  tests and by the smoke test (`verify-gate.smoke.mjs`): the check fails, the agent goes back,
  history is only appended to, the check passes, and the run ends.

### Local 27B: pending

No local numbers yet. The local runs were stopped on 2026-10-19 so they would not clash with the
HML-2 Strata trial, which takes both GPUs and the router. Before that, the router was shared with
three other benchmarks, and requests hit pi's 5-minute timeout, so no local run had finished. A
separate task runs these after HML-2:

1. `bench/run-all.sh local-27b llama.cpp/qwen3.8-27b:medium 3`: arms `local-27b-base` and
   `local-27b-gate`, all 9 tickets, 3 rounds each (54 runs). Run it alone on the router, with no
   other benchmark at the same time, so wall times and cache numbers mean something.
2. In `bench/results/summary.md`, report the prompt-cache table: the share of prompt tokens read
   from cache on the request right after a gate message, against all requests. This is the
   check that the appended message keeps the hybrid model's cache.
3. Put the rows into the table above, and update the reading.

## Files

- `index.ts`: wires the gate into pi. `gate.ts`: finds, runs and words the check (no pi needed).
- `*.test.ts`: unit tests. `verify-gate.smoke.mjs`: a headless `pi -p` run against a mock model.
- `bench/`: the measurement above. `run.ts` drives pi in-process through its SDK
  (`createAgentSession`) on a copy of `~/.pi/agent`; `run-all.sh local|cloud [ROUNDS]` runs both
  arms, `report.ts` writes `results/summary.md`; `results/*.jsonl` holds one row per run.
  `tickets/<name>/`: nine TypeScript tickets (repo, issue, reference solution, hidden
  `node:test` grader); `selftest.ts` checks that each broken repo fails and each reference passes.
