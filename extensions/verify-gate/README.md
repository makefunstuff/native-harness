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

It looks from the working directory up to the repository root (the first folder with `.git`).
Outside a git repository it looks only in the working directory itself, so an `AGENTS.md` in a
parent folder, such as the home folder, is never taken for the project's. In each folder it
checks `.pi/verify` first, then `AGENTS.md`. An empty `.pi/verify` counts as none.

- **`.pi/verify`**: a shell script. Executable files are run as they are; other files are run
  with `bash`. It runs in the folder that holds `.pi/`. For example:
  ```sh
  npm test
  ```
- **`AGENTS.md`**, in one of three explicit forms. Prose is never read for commands, so the gate
  only runs a command someone wrote down for it:
  ```markdown
  <!-- verify: make test -->
  Verify: `npm test`             (also "Check:", "Check command:", bulleted or bold)
  ## Verify                      (also "Check", "Checks"): the first code block of that section
  ```
  In the `Verify:` line form the command must end the line (a final full stop is fine), so a
  sentence such as "Check: `the docs` before committing" is not read as a command.

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

`/verify` runs the check by hand and shows the result (not in an untrusted project either).

| environment | default | |
|---|---|---|
| `PI_VERIFY_GATE` | `on` | `off`, `gate-only` (no prompt line), `rule-only` (prompt line only) |
| `PI_VERIFY_ROUNDS` | `2` | rounds of fixes per prompt |
| `PI_VERIFY_TIMEOUT` | `300` | seconds before the check is killed (counts as a failure) |
| `PI_VERIFY_MAX_OUTPUT` | `4000` | characters of output given to the model |

The check gets `PI_VERIFY_GATE_ROUND` (0, 1, 2…) in its environment.

## Measured

### The bench

`bench/run.ts` drives pi 1.3.0 in-process through its SDK (`createAgentSession`). It runs on a
copy of the owner's pi config: settings, models, global extensions, codemode and tool search, but
no MCP. Both arms get the same ticket repos. The "gate" arm loads verify-gate (the gate plus the
prompt line); the "base" arm does not. Every repo has a `.pi/verify` file, so the gate runs the
project's own check: the agent's tests (`node --test`). The `duration` ticket's check also
enforces a changelog rule that its `AGENTS.md` states.

**Tickets: the homelab evals, as TypeScript.** The eleven tickets in `bench/tickets/` are
TypeScript ports of the homelab coding evals, plus two of my own. Each is graded by hidden
`node:test` tests the agent never sees:

| homelab eval | tickets |
|---|---|
| `evals/agentic-glimmer-2026-10-14`: the six agentic pi tickets, also used by the llama-native bench | `logstats`, `cli-json`, `config-rename`, `ttlcache`, `presets-ini` (the ambiguous `argv` is now spelled out), `sqlite-migration` (`node:sqlite`) |
| `evals/local-ai-campaign-2026-09-08/capability-suite`: the three coding tasks of the local-vs-cloud comparison, single-shot there, agentic tickets here | `event-reconcile`, `schedule-repair`, `api-migration` |
| new | `isoweek` (year-boundary dates, where tests easily share the code's mistake), `duration` (the project check also covers a changelog rule) |

The homelab harnesses themselves (Python, and single-shot model calls for the capability suite)
are not run, by the owner's rule that pi-extras has no Python. The tickets carry over the same
specs, and the same hidden tests or their equivalents.

**Two prompt styles.**
- `told` adds "run the tests … Run the tests with: node --test". That alone decides what the gate
  can show: an agent told to run the check will run it.
- `plain` (the default) says only "make the change and stop when the work is done", so running
  the project's check before stopping is left to the agent. That is the case the gate is for.

### Results (cloud), 2026-10-19

Three rounds per arm, run one after the other with `bench/run-all.sh NAME MODEL 3 [plain|told]`:

| model | prompt | runs per arm | hidden tests pass, base → gate | own check green, hidden red (gate arm) | project check red when the agent stopped (base arm) | gate sent the agent back | mean wall s, base → gate |
|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | plain | 27 | 27 → 27 | 0 | 0 | 0 | 13.3 → 13.4 |
| claude-sonnet-5-5 | told | 27 | 27 → 27 | 0 | 0 | 0 | 12.6 → 12.6 |
| deepseek-flash | plain | 33 | 33 → 33 | 0 | 0 | 0 | 20.0 → 19.2 |
| deepseek-flash | told | 33 | 33 → 32 | 1 | 0 | 0 | 19.1 → 20.8 |

Claude has 27 runs per arm, not 33, because the Anthropic key in the pi config stopped working
(`401 invalid x-api-key`) before its `presets-ini` and `sqlite-migration` runs. Those runs never
reached the model, so the bench records them as provider errors and leaves them out. Full tables:
[`bench/results/summary.md`](bench/results/summary.md).

What this shows:

- **Cloud models do not need the gate, even when nobody tells them to test.** In all 240 cloud
  runs, the project's check was green when the agent stopped, in the base arms too. So the gate
  had nothing to catch: none of its 120 checks failed, and it never sent an agent back. Its cost
  is one run of the check per prompt, within noise.
- **The prompt line did not stop the one self-confirming test.** DeepSeek on api-migration
  (`told`, gate arm): its own tests passed, but `call(url, null)` sent 0 ms instead of the
  default 30 000. That is the failure this extension targets, and a green check cannot catch it.
  One miss in 33 against none in 33 is noise.
- **The case the gate is built for has not been measured.** The local 27B stops with "All done"
  and failing tests more often in the session analysis. Its runs are only partly done (next section).
  Until then, the mechanism is covered by the unit tests and the smoke test
  (`verify-gate.smoke.mjs`): the check fails, the agent goes back, history is only appended to,
  the check passes, and the run ends.

### Local 27B: pending (partial: ~16/132, stopped for Strata)

These are partial numbers, not a result. On 2026-10-19 the `local-27b-plain` series was stopped
after 16 of its 132 runs: the GPUs were reserved for Strata (HML-4) and the router model was
unloaded. HRN-13 does the full local runs after HML-4. What finished, `plain` prompt, round 1 only:

| arm | runs | hidden tests pass | own check green, hidden red | gate checks / failures | mean wall s |
|---|---|---|---|---|---|
| local-27b-plain-base | 11 of 33 | 10/11 | 1 (api-migration) | – | 114.0 |
| local-27b-plain-gate | 5 of 33 | 5/5 | 0 | 5 / 0 | 55.0 |

- The base-arm miss is the self-confirming case, again on api-migration: its own tests passed, the
  hidden test failed (actual 0, expected 30000). The project's check was green, so the gate would
  not have caught it. Only the prompt line can.
- The gate never sent the agent back in these runs, so the prompt-cache table (the request right
  after a gate message) has no local data yet.
- Too few runs to compare the arms. The gate arm has the five tickets that came first in order.
- The earlier tries failed for other reasons. They shared the single-slot router with three other
  benchmarks, their requests hit pi's 5-minute timeout, and none finished. After that, the HML-2
  Strata trial kept local models off.
- **To do**, with nothing else on the router:
  1. `bench/run-all.sh local-27b-plain llama.cpp/qwen3.8-27b:medium 3 plain`: arms
     `local-27b-plain-base` and `-gate`, all 11 tickets, 3 rounds (66 runs).
  2. `bench/run-all.sh local-27b-told llama.cpp/qwen3.8-27b:medium 3 told`: the same with the
     `told` prompt (66 runs).
  3. The prompt-cache table in `bench/results/summary.md`: the share of prompt tokens read from
     cache on the request right after a gate message, against all requests. This checks on the
     hybrid model that the appended message keeps its cache.
  4. Put the rows into the table above, and update the reading. The 16 partial runs in
     `bench/results/local-27b-plain-*.jsonl` count toward step 1 (`run.ts` resumes and skips runs it already has).
- **Optional, also pending:** the remaining Claude runs (`presets-ini` and `sqlite-migration`,
  4 arms × 3 rounds), once the Anthropic key works again.

## Files

- `index.ts`: wires the gate into pi. `gate.ts`: finds, runs and words the check (no pi needed).
- `*.test.ts`: unit tests. `verify-gate.smoke.mjs`: a headless `pi -p` run against a mock model.
- `bench/`: the measurement above. `run.ts` drives pi in-process through its SDK
  (`createAgentSession`) on a copy of `~/.pi/agent`; `run-all.sh NAME PROVIDER/MODEL [ROUNDS] [PROMPT]` runs both
  arms, `report.ts` writes `results/summary.md`; `results/*.jsonl` holds one row per run.
  `tickets/<name>/`: eleven TypeScript tickets (repo, issue, reference solution, hidden
  `node:test` grader); `selftest.ts` checks that each broken repo fails and each reference passes.
