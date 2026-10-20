# lessons

Learn from mistakes that were fixed, across sessions. When something failed in a session and was
then fixed, pi asks the agent for a short **cue / lesson / evidence / confidence** note and keeps
it. At the start of the next task in the same repository, the few notes whose cue matches the task
are looked up, a decision model keeps the ones that apply, and only those are shown to the agent.
The idea comes from Harness²'s experience library (HRN-3), cut down to what pi's extension API
allows at run time.

```
session 1   npm test ✗ (house-rules: tests/ops/vat.spec.ts missing) … fix … npm test ✓
            agent's final answer
            [lessons] Something failed and was then fixed: `npm test` failed (…), later passed.
                      If there is a lesson that would save a future task …          ← appended
            ```lesson
            cue: adding a new operation module to this repository
            lesson: give it its own tests/ops/<name>.spec.ts; npm test's house-rules pretest fails otherwise
            evidence: npm test failed with "has no test file tests/ops/vat.spec.ts", passed after adding it
            confidence: 0.9
            ```
session 2   user: Add applyDiscount(...) in src/ops/discount.ts …
            Lessons from earlier sessions in this repository (…):                       ← appended
            L1. When adding a new operation module to this repository: give it its own …
```

## What it does

- **Notices a fixed failure.** It watches `bash` results: a command that exits non-zero, followed
  later by a passing run of the same command, or of any check (tests, type check, lint, build), is
  a fix. A chain (`… && npm test && git status`) counts as its last check, and heredoc bodies are
  ignored. A piped check (`npm test | tail`) hides the exit code, so its output decides
  (`ℹ fail 2`, `npm error`, `N problems`). Searches that exit 1 for "no match" (grep, find, test,
  plain cat) are not failures, and neither are timeouts or aborts.
- **Asks once, at the end.** At `agent_before_settle` (a completed run that no other extension
  continues), it appends one request listing the fixed failures and asks for at most two
  ```` ```lesson ```` blocks, or "no lesson" for one-off slips. The request costs one extra model
  call per run that had a fix, and only then. When lessons were shown at the start, the same
  request asks for `confirms: L1` / `contradicts: L2`.
- **Recalls at the start, on demand.** On the first user prompt of a session it looks up
  `LESSONS_CANDIDATES` (8) notes for the repository and asks the judge which apply. It appends the
  `LESSONS_K` (3) best as one custom message after the prompt. When nothing applies, it adds
  nothing.
- **Costs nothing when idle.** No system-prompt text, no tool, no tool-list change. Following
  Harness²'s lever-cost rule (always-on text has to be paid for), all its text is on demand and
  appended. Nothing in the history is rewritten, so the prompt cache survives, which matters on
  hybrid Qwen, where any change to history means a full re-prefill.
- **Keeps the library small and current.**
  - Size: cue ≤ 200, lesson ≤ 500, evidence ≤ 400 characters (evidence shown cut to 160).
  - Count: at most `LESSONS_MAX` (40) notes per repository. Over the cap, the lowest confidence ×
    age decay (60-day half-life) goes first.
  - Duplicates: only the same lesson is merged (newer wording, confidence +0.1): the same cue and
    lesson words, or a related cue (≥ 30 % shared words) with a lesson sharing ≥ 60 % of the two
    lessons' words. A different lesson learnt for the same situation is kept beside the first.
  - Contradicted: −0.3 confidence; below 0.25 the note is deleted. A note at the default
    confidence (0.6, also used when the agent gives none) goes after its second contradiction, a
    0.9 one after its third. Confirmed: +0.1.
  - Deleted notes (contradicted, forgotten, evicted) leave a tombstone in the local copy, so
    Hindsight cannot bring them back. A failed Hindsight delete is retried on a later recall.
    When the same lesson is learnt again, its tombstone is cleared (and a pending delete with it).
  - Unused: notes not written or confirmed for `LESSONS_TTL_DAYS` (180) are dropped.
- **Per repository.** The key is the origin remote (host/path, credentials stripped), else
  `package.json`'s name, else the folder name (`LESSONS_REPO` overrides it).

### Where notes live

- **Hindsight**, the shared memory behind homelab-tools' `memory_retain` / `memory_recall`: same
  server, bank and key settings (`HINDSIGHT_URL`, `HINDSIGHT_BANK`, `HINDSIGHT_KEY_FILE`, same
  defaults). Each lesson is one document (`document_id` = note id, so a rewrite replaces it),
  tagged `pi-lessons` and `repo:<repo>`, with the note in its metadata. Recall is Hindsight's
  semantic + keyword search filtered to those tags, so `memory_recall` also finds lessons, and
  other machines sharing the bank get them. Hindsight is used when `HINDSIGHT_URL` is set or when
  the `memory_recall` tool is loaded (`LESSONS_STORE=hindsight|file` forces one).
  - Why not call the `memory_*` tools themselves? `ctx.executeTool()` exists only inside a tool's
    `execute()`, not in the event handlers where recall and storage happen. Registering a tool
    just for that would put its schema in every request.
- **A local copy**, one JSON file per repository under `<pi agent dir>/lessons/` (`LESSONS_DIR`),
  is always written. It is the whole library on setups without Hindsight, matched by plain text
  (idf-weighted word overlap with the cue).

**Fails soft, and says so** (as a pi notification, kept in the session):

- Hindsight unreachable or erroring on recall: the local copy is matched by plain text.
- A Hindsight write fails: the note stays local, marked unsynced, and is sent again on a later
  recall. Recall always merges Hindsight's hits with the local copy, so a failed write never hides
  a lesson.
- Jev missing or failing: the score threshold decides instead (`LESSONS_MIN_SCORE` 0.3 for
  Hindsight scores, `LESSONS_MIN_TEXT` 0.35 for plain text).
- lessons calls no embedding server itself. EmbeddingGemma sits behind Hindsight, and when it is
  down, Hindsight's own recall or retain errors trigger the fallbacks above.

### Which notes apply: Jev

The decision model homelab-tools registers as `jev-lan/jev` (a System One classifier, reached
through `ctx.modelRegistry.classify`) gets the task and the candidates, one yes/no question per
note ("would a developer doing this task make the mistake it warns about?"), in a single call.
Notes with p ≥ `LESSONS_MIN_P` (0.5) are kept, best first. `LESSONS_JUDGE=provider/id` picks
another classifier, `off` uses the threshold.

## Settings

| variable | default | |
|---|---|---|
| `LESSONS` | `on` | `off` disables the extension |
| `LESSONS_STORE` | `auto` | `hindsight`, `file`; auto = Hindsight when `HINDSIGHT_URL` is set or `memory_recall` is loaded |
| `LESSONS_DIR` | `<agent dir>/lessons` | local copy |
| `HINDSIGHT_URL`, `HINDSIGHT_BANK`, `HINDSIGHT_KEY_FILE` | as homelab-tools | `LESSONS_HINDSIGHT_BANK` overrides the bank for lessons only |
| `LESSONS_HINDSIGHT_TIMEOUT` | `60` | seconds per Hindsight call |
| `LESSONS_JUDGE` | `auto` (`jev-lan/jev` when present) | `provider/id` of a classifier, or `off` |
| `LESSONS_K` / `LESSONS_CANDIDATES` | `3` / `8` | notes shown at most / looked up before judging |
| `LESSONS_MIN_P` / `LESSONS_MIN_SCORE` / `LESSONS_MIN_TEXT` | `0.5` / `0.3` / `0.35` | judge probability / thresholds without a judge |
| `LESSONS_MAX` / `LESSONS_TTL_DAYS` | `40` / `180` | notes per repository / days unused before a note is dropped |
| `LESSONS_REPO` | (derived) | repository key |

`/lessons` lists the repository's notes; `/lessons forget <id>` deletes one, in both stores.

## Results

Cloud, DeepSeek Flash (`deepseek/deepseek-flash`, pi 1.3.0, thinking from the user's settings),
2026-10-19. Two sequences of five tickets: 4 rounds for `base` and `lessons`, 2 rounds for
`lessons-file`. Every ticket of every arm passed its hidden tests, so the difference is in how
often the agent broke a house rule it had already run into (and paid turns to fix it). Raw rows
are in [`bench/results/`](bench/results/), and the full table with per-position tallies is in
[`bench/results/summary.md`](bench/results/summary.md).

| arm | tickets | passed | **repeated mistakes** | mistakes / ticket 1 | mistakes / later ticket | later tickets with no mistake | turns / ticket | tokens / ticket |
|---|---|---|---|---|---|---|---|---|
| base | 40 | 40 | **17 / 41 (41 %)** | 0.88 | 0.72 | 16 / 32 | 10.5 | 85.0k |
| lessons: local copy + Jev (Hindsight writes failed, see note) | 40 | 40 | **0 / 36 (0 %)**, p < 0.001 | 0.50 | 0.28 | 25 / 32 | 10.0 | 80.8k |
| lessons-file (plain text, no judge) | 20 | 20 | **0 / 17 (0 %)**, p = 0.001 | 0.75 | 0.13 | 14 / 16 | 10.5 | 91.3k |

(p: Fisher's exact test against base. Tokens = input + cache read + output, the lesson request
included. The DeepSeek provider reports no cost, so there is no dollar column.)

- **No mistake was repeated once a lesson existed.** In base, the agent broke a rule it had already
  broken on an earlier ticket in 41 % of the chances. Typical cases: forgetting the CHANGELOG line
  and the `@example` comment on four dayplan tickets in a row, or putting the tests in the shared
  file instead of `tests/ops/<name>.spec.ts` on three ledger tickets out of five. With lessons, the
  remaining later-ticket mistakes are all first occurrences: a rule no earlier ticket of that run
  had broken, so there was no lesson for it yet.
- **What it costs.**
  - Request: 15 of 40 tickets ended with a lesson request (only runs with a fixed failure). Each is
    one extra model call of about 11k prompt tokens, 97 % of them served from the prompt cache
    (the request is appended), plus ~150 output tokens.
  - Recall: 25 tickets got lessons appended (one note, ~590 characters ≈ 150 tokens). Hindsight
    lookup plus one Jev call take about a second.
  - Net: tokens per ticket went down 5 % (85.0k → 80.8k), and turns on tickets 2–5 from 10.7 to
    9.6, because fewer check-fix rounds were needed. lessons-file used more tokens (91.3k) over
    only 20 tickets: two first tickets with long explorations (13.5 turns on ticket 1 against 9.9
    in base) weigh heavily there.
- **Library code changed after these runs** (review fixes):
  - Dedupe now merges only the same lesson, never a different lesson under a similar cue.
  - A contradiction costs −0.3 instead of −0.4.
  - Deleted notes leave a tombstone.
  - A commit message or echo that mentions "test" no longer counts as a passing check.
  - A check whose exit code a later command hides (`npm test; echo $?`) is judged by its output.
  - Recall rows now say where each candidate came from (`recall.candidates[].source`,
    `recall.hindsightHits`). `recall.source` only says the Hindsight call worked. In the
    rows above every `source` is `hindsight`, but with the writes failing the candidates
    there came from the local copy.

  The runs hit the old merge once (dayplan round 3). There, a newer note restating the
  `@example` rule and adding the CHANGELOG rule replaced the older note. That was a superset, so
  nothing was lost; under the new rule both would be kept. They hit no contradiction, so the
  numbers above stand.
- **Jev** kept 25 of 26 candidates (p 0.73–0.95). The one it rejected was right to go: a note
  about unpacking the bundled checker's base64 payload, offered for a ticket that only needed to
  add an operation.
- **The notes the agent wrote** were specific and correct. For example: *"When adding a new
  operation module under src/ops/: put each operation's tests in its own file at
  tests/ops/<name>.spec.ts, add a matching `## <fn>` section to docs/operations.md, … list any new
  error codes in src/codes.ts; run `npm test` to let house-rules verify all of this."* It answered
  "no lesson" for one-off slips (a wrong expected value in its own test).
- **Note on Hindsight during these runs.** While the Strata trial (HML-2) held most of the
  machine's memory, Hindsight's Postgres refused every write (`could not resize shared memory
  segment … No space left on device`). Recall calls answered (empty), and bank creation failed.
  - So the `lessons` arm ran its fallback path: notes from the local copy, plain-text matching,
    Jev judging. The extension reported every failed write as a warning (the "fallbacks" column in
    the summary).
  - The Hindsight path itself worked in a probe on this machine before the outage: a tagged
    retain, then recall returned the note with its metadata (score 1.10), and Jev kept it at
    p = 0.92 in a trial run. It is covered by unit tests against a fake Hindsight server.
  - A cloud run with Hindsight writes working is still to do (see "Local: not measured" below).
- **What this shows and what it does not.**
  - The tickets are built so that house rules are learnt by failing: a policy checker states
    them only on failure, the way a CI policy or a linter plugin does. On rules that the code
    shows plainly, DeepSeek Flash makes no mistake to learn from. In a first version, where the
    rules sat in a readable test file, it read everything first and made none.
  - It still sometimes unpacks the bundled checker to read the rules. That is part of why
    ticket-1 mistake counts vary (0.50–0.88 with nothing learned yet in any arm).
  - A hand-written `AGENTS.md` line would prevent the same mistakes; lessons writes that line
    itself, and only shows it when the task needs it.

## Local: not measured (skipped by the owner)

The local runs planned for HRN-13 were **not run**: base, lessons and lessons-file on a local model,
and the prompt-cache check on the request that answers the lesson request. The owner skipped them
on 2026-10-20 because the local model now in use, Swift 1.5 Qwen3.8-Flash-Next IQ3_S on Strata
(`strata/swift-1.5-flash-next-iq3_s`), already passes coding tickets in the other extensions'
local runs: verify-gate 42/44, loop-guard 10/10 and local-edit 6/6. These numbers are about
passing tickets, not about repeated house-rule mistakes, which is what this bench measures. So
there is still no local figure for the repeated-mistake rate.

Also still to run on cloud, once Hindsight takes writes again (it does not depend on the GPUs):
`node extensions/lessons/bench/run.ts lessons --model deepseek/deepseek-flash --rounds 4 --out lessons-hindsight`.

## The benchmark

`bench/` measures the **repeated-mistake rate across a sequence of related tickets**, with and
without the extension, by driving pi in-process through its TypeScript SDK
(`createAgentSession`).

- **Two sequences of five related tickets**, each on its own small TypeScript repository
  (`bench/sequences/<seq>/repo`). Every ticket starts from the same repository, so tickets are
  independent except for what the extension carries over.
  - `ledger`: a money library. Each ticket adds an operation (`vatFor`, `applyDiscount`,
    `splitEvenly`, `convertCents`, `simpleInterest`).
  - `dayplan`: calendar-day helpers. Each ticket adds a function (`addBusinessDays`, `endOfMonth`,
    `isoWeekRange`, `daysBetween`, `nthWeekdayOfMonth`).
- **House rules that the source does not show.** `npm test` runs a dev dependency, `house-rules`,
  as pretest. It is installed into `node_modules` as a compressed bundle, the way most `dist/`
  builds ship, and it states a rule only when the rule is broken, the way a linter plugin or a CI
  policy does.
  - `ledger`: every operation is documented in `docs/operations.md`, has its own
    `tests/ops/<name>.spec.ts`, and lists its new error codes in `src/codes.ts`.
  - `dayplan`: every exported function is in `CHANGELOG.md` and has a `/** … @example … */`
    comment, and no local-time `Date` methods are allowed.
  - Every ticket can break the same rules again; that repetition is what lessons should remove.
    The readable checker source is in `bench/sequences/<seq>/house-rules/cli.mjs`.
- **Grading**: hidden `node:test` specs per ticket (behaviour, error codes, the public API, UTC
  correctness in five time zones), plus the bench's own copy of the checker.
- **Mistakes**: a rule broken during the session (the checker's message in the agent's own
  `bash` output) or left in the final tree (the grader's checker run).
- **Repeated-mistake rate**: on tickets 2–5, every rule already broken on an earlier ticket of the
  same run is an opportunity, and repeating it counts. Fisher's exact test compares arms.
- **Arms**:
  - `base`: no extension.
  - `lessons`: Hindsight (a fresh bank per sequence and round, deleted afterwards) + Jev.
  - `lessons-file`: the fallback, local file + plain-text matching, no judge.
- Each arm runs on a fresh copy of `~/.pi/agent` (`PI_AGENT_SRC`), so the real config is never
  touched (the user's global extensions, e.g. homelab-tools for Jev, load as usual). Runs are
  sequential and remove their work trees.

```bash
node extensions/lessons/bench/selftest.ts          # tickets: base fails, references pass, every trap is caught (in check.sh)
node extensions/lessons/bench/run.ts base         --model deepseek/deepseek-flash --rounds 4
node extensions/lessons/bench/run.ts lessons      --model deepseek/deepseek-flash --rounds 4
node extensions/lessons/bench/run.ts lessons-file --model deepseek/deepseek-flash --rounds 2
node extensions/lessons/bench/report.ts > extensions/lessons/bench/results/summary.md
```

Results go to `bench/results/<arm>.jsonl`, one row per ticket. A half-finished sequence is rerun
from its first ticket, since later tickets depend on its lessons. Sessions, diffs and the final
libraries go to `~/.cache/pi-extras/lessons/`.
