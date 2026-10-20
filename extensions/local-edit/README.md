# local-edit

pi's `edit` tool, made forgiving for local models, with clear failures.

Local models fail far more edits than cloud models in pi: in 86 local sessions **15.4 %** of edits
failed, against **4.9 %** for cloud models. Most failures are near misses: a typo in `oldText`, the
wrong indentation, a basename instead of a path, `\n` written literally. pi's own fuzzy match only
covers trailing whitespace, Unicode quotes, dashes and NFKC. On a miss it answers "Could not find
the exact text" and gives no hint. Edits that succeed can still destroy code, for example a
replacement that drops the lines next to it. The result says it succeeded, so nobody notices.

local-edit replaces the built-in `edit`. It reuses pi's implementation
(`createEditToolDefinition`) and adds four things around it:

| | what it does |
|---|---|
| **tolerant matching** | when `oldText` is not found exactly (or by pi's own fuzzy match), it is placed when exactly one spot fits: 1. the same text with literal `\n`/`\t` decoded; 2. the same lines with indentation ignored; 3. a window of whole lines (same count, ±1) that is **≥ 0.95 similar** (Levenshtein ratio on whitespace-normalised text), with no other non-overlapping window reaching 0.95, and first and last lines that each look alike (≥ 0.8), so a partial line is not swallowed; a one-line `oldText` may also match part of a line. `newText` is re-indented from the model's indentation to the file's. Two or more candidates means no edit, and the error lists their line numbers. A loose match never writes the model's stale text back. Where `oldText` misremembers a line that the edit does not change, the file's text is kept, and the result says at which line. The edit is refused when it changes the misremembered text itself, or when `oldText` leaves out a line of the file or has one the file does not have there. |
| **clear failures** | on a miss, the closest candidate lines with line numbers and their similarity, instead of "Could not find the exact text". For a long `oldText` it also gives the line numbers of its first and last lines. It names the edit of the same call that writes the text a later edit looks for (all edits of a call are matched against the original file). It names the other file that contains the text, if any. Duplicates are reported with the line numbers of each occurrence. |
| **compact diff** | every successful edit returns a diff of the removed (`-`) and added (`+`) lines with line numbers and one line of context, capped at 60 lines. It warns when 3 or more non-blank lines were removed and not put back, or when `newText` contains a placeholder such as `// ... rest unchanged`. |
| **path repair** | `path#tag`, `path:12`, `path:12-30`, `a/`/`b/` diff prefixes, and a basename or partial path, used when exactly one file under the working directory matches. Several matches: an error that lists them. |

It also repairs arguments in `prepareArguments`, which runs before schema validation. It accepts
`file_path`/`old_string`/`new_string` aliases, a single edit object, and `edits` sent as a JSON
string. It works on a copy, so the assistant message in the history is never changed. A missing
`newText` is still rejected, never turned into a deletion.

What the model sees, for an edit with the wrong indentation and a basename path:

```
Successfully replaced 1 block(s) in pkg/calc.py.
Note: path "calc.py" resolved to "pkg/calc.py"; oldText: matched lines 3-4 (indentation ignored).
Diff (-1 +1 lines; "-" = removed, "+" = added, numbers are line numbers):
 3     for x in xs:
-4         s += x
+4         s += x * 2
 5     return s
```

and for a miss:

```
Could not find the text in pkg/calc.py: no exact match, and no unique match at ≥95% similarity.
Closest text in the file:
line 5 (57% similar):
5|     return s
line 1 (36% similar):
1| def total(xs):
line 3 (36% similar):
3|     for x in xs:
Copy oldText exactly from these lines (without the "N| " prefixes), or read the file again.
```

## Prompt cache

The tool keeps pi's name, description, schema, prompt snippet and guidelines. The system prompt
and the tool list are byte-identical with and without the extension: the first request of a mock
run was compared with and without it. Everything the extension adds goes into the tool result,
which is appended to the conversation, so history is never rewritten. That matters on hybrid Qwen
(llama.cpp `--cache-reuse` cannot apply, so any change to earlier history forces a full re-prefill).

## Use

It is part of the pi-extras package and is on by default once the package is installed. Turn it
off with `pi config`, or with `"-extensions/local-edit/index.ts"` in the package's `extensions`
filter. To try it for one run: `pi -e ./extensions/local-edit/index.ts`.

## Results

Measured on 2026-10-19 with pi 1.3.0. Two measurements: an offline replay of real sessions,
and a live bench through pi's SDK. Both are TypeScript: `bench/replay.mjs`, and
`bench/run.ts` with `bench/report.ts`. The local part of the live bench is a reduced sample
(section 5).

### 1. Replay of real sessions

`node extensions/local-edit/bench/replay.mjs` reads pi sessions on this machine:
`~/.pi/agent/sessions`, plus the plain-ticket bench sessions of the llama-native, d3-context and
verify-gate experiments. It leaves out the trap tickets of loop-guard and thinking-guard, which
fail edits on purpose. For every edit call it rebuilds the file as the model saw it: from a full
`read`, a `cat FILE`, or a `write`, with the earlier successful edits applied on top. It then runs
the call through pi's own edit tool and through local-edit's matcher. Snapshot:
[`bench/results/replay.json`](bench/results/replay.json).

| | local: llama.cpp | local: Strata | cloud |
|---|---:|---:|---:|
| sessions / edit calls | 42 / 111 | 52 / 265 | 450 / 329 |
| failed edits with pi's edit | 11 (9.9 %) | 21 (7.9 %) | 4 (1.2 %) |
| … of which the file content could be rebuilt | 6 | 7 | 2 |
| … placed by local-edit | 1 (98.9 % similar, a typo in a 28-line `oldText`) | 2 (similarity, e.g. 97.2 % on a 14-line block) | 0 |
| … still refused, with a better message | 5 | 5 | 2 |
| successful edits replayed: same file with local-edit | 49 / 49 | 111 / 111 | 127 / 127 |
| **edit error rate** | **9.9 % → 9.0 %** | **7.9 % → 7.2 %** | 1.2 % → 1.2 % |

Re-run on 2026-10-20, after the local runs of HRN-13. The session set grew since the first
snapshot (22 local sessions then): it now includes the local bench sessions of verify-gate, and
the Strata (Swift 1.5 Flash-Next) sessions on this machine, which the replay now counts as local.

The refusals are right to refuse:
- `oldText` lines that are not in the file at all (the model made them up).
- A stale view of a file; local-edit now shows the right spot at 77 % similarity.
- An edit for the wrong file. local-edit names the file that contains the text, when there is one.
- An `edits[2]` that looks for text that `edits[0]` of the same call writes. local-edit now says
  exactly that.
- A duplicate. local-edit gives the line numbers of both places.

None of the 287 successful edits changes outcome under local-edit. Only 13 of the 32 local
failures could be rebuilt, so read the local rates as a direction, not a measurement: local-edit
places about one rebuilt failure in four, and refuses the rest with a clearer message.
These sessions include none of the basename or `path#tag` failures that the findings doc counts
in OMP's hashline sessions. The tree those OMP sessions edited has changed since, so those calls
cannot be replayed reliably and are not counted.

### 2. Live bench, cloud: DeepSeek Flash

`bench/run.ts` drives pi in-process through `createAgentSession`. It runs on a copy of the pi
config, with an in-memory session. The local-edit arm loads this extension through
`DefaultResourceLoader`; the base arm uses pi's own edit. The tickets are the three edit-heavy
TypeScript tickets in `bench/tasks/` (`gen-tasks.ts`):
- `edit-handlers`: a 570-line module of 16 near-identical classes.
- `edit-tabs`: a tab-indented module.
- `edit-table`: a table of long lines.

Hidden `node:test` tests grade the behaviour, and also fail when a function or method the ticket
did not ask to change was changed or removed (the destructive-edit check). Each arm ran
6 rounds × 3 tickets: [`bench/results/`](bench/results/summary.md).

| arm | runs | hidden tests pass | edit calls | edit errors | placed loosely | untouched-code check failed | edits dropping ≥ 3 lines |
|---|---:|---:|---:|---:|---:|---:|---:|
| base (pi's edit) | 18 | 18/18 | 30 | 1 (3.3 %) | – | 0/18 | 3 |
| local-edit | 18 | 18/18 | 26 | 0 | 0 | 0/18 | 0 |

What this shows:
- **No regression.** Pass rate, edit counts and wall time (median 11 s vs 12 s) are the same.
- **The bench cannot tell the arms apart on errors.** DeepSeek Flash almost never misses an edit.
  The one baseline error was malformed JSON arguments, which pi rejects before any edit code runs,
  so it says nothing about either arm.
- **The 3+-line drops were not destroyed code.** I read all three (all in the base arm): each is a deliberate rewrite
  of the model's own test.
- **Claude was not measured.** In the first version of this bench, Claude Sonnet 5.5 made no
  `edit` calls at all (it edits through bash scripts), so it was left out.

### 3. Behaviour checks

These are unit tests in `index.test.ts`, plus the review probes. Things that pi's own edit
rejects, and local-edit places correctly:
- wrong indentation;
- tabs vs spaces, re-indented to the file's style;
- a one-character typo in a multi-line block;
- a typo inside a line that contains a literal `\n`;
- double-escaped `\n`;
- a basename path, `path#tag` and `path:12-14`.

Things it refuses on purpose:
- an `oldText` that misremembers a value the edit then changes;
- a block with a line left out;
- two equally good places.

When `oldText` misremembers a value the edit does *not* change (`timeout: 30` for a file's
`300`), it keeps the file's value and says so. It never writes the model's stale copy back.

### 4. Cost of a miss

The search runs synchronously inside pi, so it is bounded:
- **Ranking:** windows are first ranked by bigram overlap, which is linear in the file size.
- **Exact scores:** the exact Levenshtein ratio is computed only for the best window of at most
  6 separate places. A place's shifted windows are scored only when its best one comes close.
  Scoring stops once two places reach 95 %, since the edit is then ambiguous anyway.
- **Work budget:** about 1.2·10⁸ cells. A strong candidate left unchecked when the budget runs
  out counts as a possible rival, so the edit is refused, never guessed.
- **Size limits:** an `oldText` over 20,000 characters is not placed loosely. Candidates over
  2,500 characters show the bigram score.
- **One-line `oldText`:**
  - Lines are first filtered by bigram containment, in one linear pass. A match ≥ 95 % similar
    keeps at least 90 % of the pattern's bigrams, so nothing that could match is dropped.
  - The lines left get Ukkonen's cut-off check, about k·|line| cells with k = 5 % of the pattern,
    within a budget of 6·10⁷ cells.
  - The full quadratic substring search runs only on lines that pass that check (at most two).
  - Lines the budget could not check are reported as "too much alike to tell apart quickly", and
    the edit is refused.

Timings:
- A 300-line stale `oldText` against a 3,000-line file: 37.6 s before this bound, **32 ms**
  after, through `tool.execute`.
- A 500-line one against 2,000 lines: 98 s before, 7 ms after.
- A 300-line block with one typo is still placed, in 0.44 s.
- The worst case found, a 360-line near-miss in a 4,000-line file of repeated lines, takes 0.3 s.
- One-line misses in files of long, alike lines take 14–144 ms (they took 1–25 s before this bound):
  - a stale 977-character record in a 3,000-line JSONL file: 107 ms through `tool.execute`;
  - a 1,995-character line against 2,000 alike lines: 144 ms;
  - a CSV-like row against 5,000 long rows: 75 ms.
- `index.test.ts` checks these bounds.

### Homelab evals: not run

The task asked for the homelab evals too. Their coding tasks
(`local-ai-campaign-2026-09-08/capability-suite`) are graded by Python validators. The
no-Python rule for this repository rules them out until they are ported, so they are not part of
these numbers.

### 5. Live bench, local: reduced sample

**One round per arm, against six rounds in the cloud run** (the owner cut the local series short to
save GPU time). The model is **Swift 1.5 Qwen3.8-Flash-Next IQ3_S on Strata**
(`strata/swift-1.5-flash-next-iq3_s:medium`), not the Qwen3.8-27B on the llama.cpp router that was
planned. The router stayed off for this task. The tickets, arms and grading are the same as in
section 2 (`bench/run.ts strata-base|strata-local-edit --first-round 1`, plus `report.ts`).

| arm | runs | hidden tests pass | edit calls | edit errors | placed loosely | untouched-code check failed | edits dropping ≥ 3 lines | median wall s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| base (pi's edit), Strata | 3 | 3/3 | 8 | 0 | – | 0/3 | 0 | 59 |
| local-edit, Strata | 3 | 3/3 | 6 | 0 | 0 | 0/3 | 0 | 56 |
| *base, 27B, partial (before the router went off)* | 2 | 2/2 | 4 | 0 | – | 0/2 | 0 | 240 |
| *local-edit, 27B, partial* | 2 | 2/2 | 4 | 0 | 0 | 0/2 | 0 | 269 |

- **No regression, and nothing to tell the arms apart.** Like DeepSeek Flash, the local model made
  no failed edit on these tickets, so local-edit had nothing to rescue. Its value on local models
  rests on the replay above, where the failures do occur.
- Six runs (plus four on the 27B) are too few for more than that. Full tables:
  [`bench/results/summary.md`](bench/results/summary.md).

## Files

- `index.ts`: the tool: argument repair, path repair, matching, then pi's own edit, then the diff.
- `match.ts`: tolerant matching and candidate search (pure functions).
- `diff.ts`: the compact diff and the dropped-code warnings.
- `paths.ts`: path repair, and the search for the text in other files.
- `index.test.ts`: unit tests. `local-edit.smoke.mjs`: an end-to-end `pi -p` run with the
  package installed from git, against the mock model.
- `bench/`: `run.ts` (the live bench, on pi's SDK), `run-all.sh`, `report.ts`, `replay.mjs`
  (offline replay of real sessions), `gen-tasks.ts` (the TypeScript tickets in `bench/tasks/`),
  `selftest.ts` (run by `scripts/check.sh`: tickets reproducible, originals fail, references
  pass), and the `results/`.
