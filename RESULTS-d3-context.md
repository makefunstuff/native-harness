# Results: d3 context management (HRN-2)

## Verdict

**No. Letting d3 manage the context did not help the agent solve more or waste less. It made
runs cost more and barely shrank the context.** It is not worth taking further in this form.

These numbers are from the corrected extension. In the first version the pressure fallback measured
the unedited transcript, so it fired at almost every check in long runs. Those runs were re-done;
see "Correction" below.

- **Solve rate: no difference, and none was possible.** deepseek-flash solved every run in every arm
  (base 44/44, d3-flash 22/22, d3 27B 4/4). The tickets were too easy for this model to show a
  difference in solve rate.
- **Context and tokens: a small cut, mostly within noise.**
  - Per run, d3-flash processed 7% fewer tokens overall and 10% fewer on the two long bundled
    tickets. Two equal halves of the base arm already differ by 6% and 15%.
  - On the bundles the median peak context fell from 114k to 96k, the median context per request
    from 60k to 53k, and pi's own compactions from 1.1 to 0.25 per run.
  - On the nine single tickets (peaks of 20-60k) tokens were −3%.
- **Cost: clearly higher.** Per run, cost was +57% overall (3.18 → 4.98 ¢), +76% on the bundles
  (8.9 → 15.7 ¢) and +36% on the single tickets. Halves of the base arm differ by 3% and 14%, so
  this is well outside the noise.
  - The reason is the provider's prefix cache. Every edit in the middle of the transcript turns the
    rest of the next request into cache misses, and a miss costs 50× a hit ($0.30 vs $0.006 per
    M tokens). Cache-miss input rose 2.1× overall and 2.4× on the bundles.
  - The extra misses on the bundles (237k per run, about 6.8 ¢) account for the whole cost gap.
    They come from the large re-reads after edits, not from the moving notes block: small
    per-request misses were the same as base (2.7k vs 2.7k).
  - This happens even though edits were rare: one every ~11 turns on the bundles, 33 of 37 at a
    subtask boundary.
- **Forgetting: real but not fatal.**
  - d3-flash said "drop" for 74% of the items it judged, at a median confidence of 0.57. Its "keep"
    answers sat at 0.46.
  - Reading the transcripts, I count about 7 cases in 6 of 22 runs where the agent fetched again,
    within 1-3 turns, something d3 had just removed while it was still using it. Example:
    config-validator round 1 dropped the spec at turn 5, and the agent searched it again at turn 6.
  - No run failed because of it.
- **The 27B d3 is worse here, not better.** On the bundles:
  - cost +110% (18.7 ¢ per run), tokens −2%;
  - about 9 forgetting cases in 3 of 4 runs, several of them re-running the same `cat` in the
    next turns;
  - each call took ~2.1 s (p90 3.9 s), against 0.6 s for d3-flash.

  A better judge does not fix the problem, because the problem is editing a cached prefix.
- **Latency:** d3 adds no wall time in this design. Decisions run in the background and apply at
  the next request: wall time per run was 61 vs 60 s on average, 133 vs 141 s on the bundles. It
  costs GPU time, though: d3-flash was busy for 52% of the agents' wall time, the 27B for 90%.
- **Where it hurt:** cost ×1.9 on release-a, ×1.7 on release-b, ×1.6 on api-v2-migration and
  prod-incidents, ×1.5 on legacy-report, wide-rename and perf-hotspots. Tokens went up on
  etl-pipeline (+58%) and api-v2-migration (+20%). **Where it helped:** tokens −29% on release-b,
  −30% on issue-triage and −20% on wide-rename, but at no lower cost anywhere (ci-triage,
  config-validator and issue-triage were about even on cost).

**The data is thin.**
- There are 2 runs per ticket for d3 and 4 for base; only 2 tickets have real context pressure; the
  27B arm is 4 runs.
- The noise floor (base rounds 1-2 vs 3-4, in `results/ctx/summary.md`) puts the token savings
  inside the noise. The cost increase is several times larger than the noise and is explained by
  the cache arithmetic, so its direction is solid; its exact size is not.

**If it is taken further at all:** stop editing the middle of the context. Use d3 only where an
edit is free or unavoidable:
- at the moment pi compacts anyway (choose *when* to compact: at a subtask boundary, instead of when
  the window is full);
- to choose *what* survives the compaction (the pinned notes).

Even then, it is only worth it with a provider or local server where a re-read costs about the same
as a cached read, or when sessions really overflow the window. Neither was the case here.
d3-flash's drop decisions would also need fitting first. These transcripts give labels for that for
free: "removed, then fetched again" is a wrong drop.

## What was run

- **Agent:** stock pi 1.3.0 with the owner's configuration, using a copy of `~/.pi/agent` (made by
  `LINK_NATIVE=0 scripts/make-pi-agent-copy.sh ~/.cache/native-harness/pi-agent-d3`), model
  `deepseek/deepseek-flash:medium` via DeepSeek's own API. The key is read by pi the way it always
  is; nothing was printed or stored. Every arm ran the same pi, model, thinking level and limits
  (40 min timeout; pi's default compaction at window − 16k), 3 runs per arm in parallel.
  - The corrected d3 arm (rounds 1-2) ran at the same time as base rounds 3-4.
  - Base rounds 1-2 ran next to the superseded first d3 version.
  - Base is reported over all four rounds, and the two halves give the noise floor.
- **Context manager (`d3` arm):** `extension/d3-context/index.ts`, loaded with `pi -e`. It works in
  pi's `context` hook, which rewrites each request without touching the session file:
  - It considers every tool output, file read and old assistant turn of at least 1,500 characters
    that is older than the newest 2 turns.
  - Every 2 turns it asks d3 two things: is the agent at a subtask boundary, and should each item be
    kept, summarised or dropped?
  - For items to remove, one further question per key line (paths, errors, failing tests, values)
    decides which lines are pinned.
  - Decisions are applied at a boundary (p ≥ 0.5). As a fallback they are also applied when **the
    request as actually sent** (earlier edits and the notes block included) is estimated at ≥ 80k
    tokens. Either way, an edit must save at least 4,000 characters.
  - A drop becomes a one-line stub. A summary is extractive: head, tail and key lines (d3 does not
    write text).
  - The pinned lines of all removed items are collected in one shared "Pinned notes" block of at
    most 3,000 characters, oldest first out. The block rides on the newest message of each request,
    so changing it only touches the uncached tail.
  - Edits are sticky, so the prefix is stable between edits.
  - Every decision is logged with its probabilities (`*.d3.jsonl` in `results/ctx/raw-artifacts.tar.xz`).
- **Decision model:** `vllm-d3-flash` (9B, Q8_0), served with the router preset's own flags
  (`[vllm-d3-flash]` in models.ini: CUDA1, 8k context, ubatch 4096). The `d3-27b` arm used
  `vllm-d3` (27B) on the two bundles only. Embeddings (bringing dropped items back) were not built.
  The stub tells the agent to re-run the tool, which is cheap.
- **Tickets** (`bench/tasks-long`, generated deterministically by `bench/gen_long_tasks.py` and not
  committed; hidden tests; self-tested by `bench/selftest.sh tasks-long`):
  - nine messy tickets: a red CI log, a 9k-line production log plus a behaviour doc, a 28-module
    rename, an API v1→v2 migration driven by a 940-line changelog, a performance fix with a profiler
    dump, a legacy report checked against a golden file, a 4-stage ETL with mixed encodings, a
    validator built from a long spec, and an issue-tracker export where only the open, accepted bugs
    may be fixed;
  - two bundles that each put four of them into one repo as "release blockers". These are the long
    sessions: 25-58 turns, peak context 82-124k.
- **Measures:** `bench/ctx_run.py` (per-run rows from pi's session usage and the extension log),
  `bench/ctx_report.py` (→ `results/ctx/summary.md`), and `bench/ctx_forgot.py` /
  `bench/ctx_quick_refetch.py` (candidates for "forgot something", then read by hand). Cost is at
  deepseek-flash peak list prices (cache hit $0.006, miss $0.30, output $1.20 per M), the same for
  every run.

## Numbers

Means per run (the arms have different run counts):

| | base (44 runs) | d3-flash (22) |
|---|---|---|
| solved | 44/44 | 22/22 |
| tokens processed | 711k | 659k |
| … cache-miss / cache-hit input | 55k / 646k | 116k / 533k |
| cost, mean / median | 3.18 / 2.02 ¢ | 4.98 / 2.28 ¢ |
| context per request, median of runs | 31.5k | 28.5k |
| peak context, median / max | 40.6k / 123.7k | 40.9k / 101.8k |
| turns, mean / median | 16.9 / 13 | 17.7 / 12 |
| wall time, mean / median | 60 / 39 s | 61 / 43 s |
| d3 latency, p50 / p90 | – | 0.61 / 1.17 s |
| edits applied, total (at a boundary / under pressure) | – | 33 / 4 |
| items dropped / summarised, total | – | 201 / 20 |

The two bundled tickets (means per run):

| | base (8 runs) | d3-flash (4) | d3 27B (4) |
|---|---|---|---|
| solved | 8/8 | 4/4 | 4/4 |
| tokens processed | 2,350k | 2,115k | 2,304k |
| cache-miss input | 170k | 407k | 499k |
| cost | 8.93 ¢ | 15.69 ¢ | 18.71 ¢ |
| peak context, median | 114k | 96k | 100k |
| context per request, median | 60k | 53k | 63k |
| turns | 39.0 | 41.0 | 35.5 |
| wall time | 141 s | 133 s | 175 s |
| pi compactions | 1.12 | 0.25 | 0.50 |
| d3 busy time | – | 86 s | 158 s |
| edits (boundary / pressure) | – | 2.8 / 1.0 | 2.2 / 0.8 |

Noise floor, base rounds 1-2 vs 3-4 per run: tokens 732k vs 690k, cost 3.23 vs 3.14 ¢. On the
bundles: tokens 2,543k vs 2,156k, cost 9.59 vs 8.27 ¢. Per ticket: `results/ctx/summary.md`.

### "Forgot something it needed"

No agent message mentioned a removal (one in the 27B arm), and no tool call was repeated
byte-for-byte after a removal. The forgetting shows up as re-fetching. Removed file outputs re-read
within 3 turns:
- d3-flash: 17 of 136 (12%);
- 27B: 11 of 52 (21%);
- base, for comparison: 32% of all file reads are re-read within 3 turns anyway.

Most re-reads are therefore normal working style: narrower `sed -n` ranges, verification with
`git diff`. Reading the candidates by hand (`bench/ctx_quick_refetch.py --show`):
- **d3-flash, about 7 real cases in 6 of 22 runs:**
  - the config spec (config-validator r1),
  - `kv/cli.py` (issue-triage r1),
  - the behaviour doc (prod-incidents r1),
  - the ledger modules (release-a r1),
  - the changelog (api-v2-migration r2),
  - the behaviour doc and the log (release-a r2).
- **27B, about 9 cases in 3 of 4 runs:**
  - release-a r1 dropped the ledger and billing modules, `kv/cli.py` and the tests, and the agent
    cat-ed each of them again 1-3 turns later;
  - release-b r2 did the same with `report.py`, the changelog headings and a `git diff`.

None of these made a ticket fail.

## Why it costs more

An edit at position p turns every later token of the next request from a cache hit into a miss.
Removing X tokens saves X × (hit price) on each later request, and costs about the suffix length
S × (miss − hit) once. With DeepSeek's 50:1 price ratio, an edit pays for itself only after about
49·S/X more requests. Here S ≥ X, and whole sessions are 10-58 requests long, so on price edits
essentially never pay. Limiting edits to subtask boundaries made them rarer (one every ~11 turns
on the bundles) but did not change that: each one still re-read ~60k tokens at the miss price.

They would pay on tokens processed and context size, which matter for a local llama.cpp server or
a small-window model. But the savings measured here are small, and on HRN-1's hybrid local model an
edit also forces a recompute of everything after it.

## Correction (after review)

The first version of the extension estimated the context for its pressure fallback from the
original transcript and ignored its own edits. Once a long run's raw history passed 80k tokens,
the fallback therefore applied d3's drops at almost every check (every ~2 turns), while the request
actually sent was 20-50k tokens and the agent was not at a boundary. 31 of that version's 33
pressure edits were such misfires, and they drove its results: tokens −32% and cost +55% on the
bundles, with many forgetting cases.

The estimate is now taken from the edited request, notes block included. The d3 arms were re-run
(d3-flash rounds 1-2 on all 11 tickets, the 27B on the bundles), together with two more base
rounds. In the new logs every pressure edit followed a real request of ≥ 78k tokens: 4 for
d3-flash, 3 for the 27B. At the same time the pins moved from each stub into one shared notes
block.

The superseded rows are kept in `results/ctx/superseded/` (and in the archive) and are not used in
any table. The conclusion did not change in direction. It got clearer: with the fallback fixed,
the context savings are smaller and the cost penalty remains.

## Deviations and things found on the way

- **The router could not serve d3.** Its `LimitNPROC=4096` was used up by the user's other processes
  (about 3,300 leftover `herdr-projects` processes), so every model spawn failed with "Resource
  temporarily unavailable" and the router retried in a tight loop. I did not change the router or
  stop it. d3 ran on my own llama-server on loopback instead, from the router's build (same
  `/v1/systemone` code), with the preset's flags. It was stopped at the end and both GPUs are free.
- **One multi-question call is not cheaper on d3.** The server runs each question of a d3 request
  as its own full forward pass over the whole state (non-causal attention, no shared prefix), so a
  joint call costs n_questions × state. The first version took up to 7 s per check. The extension
  therefore asks one small call per item, with only that item in the state.
- **Decisions run in the background.** Waiting for them added 26 s to a 65 s pilot run. They now
  apply from the next request on, so wall time is not affected. The price is that an edit lands a
  turn or two after its decision.
- **The router's `vllm-d3` (27B) preset cannot answer these requests.** With `ubatch-size = 512`,
  every state longer than 512 tokens fails ("input is too large to process"), because a
  non-causal pass needs the whole input in one ubatch. The first 4 runs of the 27B arm were invalid
  for this reason; they are kept in `results/ctx/invalid/`. The 27B then ran with ubatch 2048 and
  without the vision projector; ubatch 4096 ran out of memory on the two 16 GB cards.
- **DeepSeek reads files with `cat`/`sed` in bash, not pi's `read` tool.** It also prefixes nearly
  every command with `cd <work dir> &&`; the extension strips that from its labels.
- **The ticket repos of the first base rounds and the superseded d3 runs contained stray
  `__pycache__/*.pyc` files**, written when the generator imported them to compute expected values
  (one agent noticed them in `git status`). The generator no longer writes them; base rounds 3-4
  and the corrected d3 runs had none. Both arms of each pairing had the same files.
- **Ten tickets were planned.** I wrote nine single tickets plus the two bundles. In the pilot
  every single ticket was solved in 20-110 s at a peak of 20-56k, so the bundles are what gives
  context pressure.
- Round 0 rows in the raw files are pilot runs; they are excluded from every table, and their
  per-run files are not kept.

## Reproduce

```bash
python3 bench/gen_long_tasks.py && bash bench/selftest.sh tasks-long      # tickets
LINK_NATIVE=0 scripts/make-pi-agent-copy.sh ~/.cache/native-harness/pi-agent-d3
# d3-flash on loopback, the router preset's flags (or the router's /v1 when it can spawn models):
llama-server --host 127.0.0.1 --port 18190 -m vllm-d3-flash-Q8_0.gguf --mmproj mmproj-vllm-d3-flash-Q8_0.gguf \
  --ctx-size 8192 --device CUDA1 -ngl all --fit off -fa on --parallel 1 -b 4096 -ub 4096 --kv-unified
export D3_URL=http://127.0.0.1:18190/v1
python3 bench/ctx_run.py base --rounds 2 --jobs 3 & python3 bench/ctx_run.py d3 --rounds 2 --jobs 3
python3 bench/ctx_report.py; python3 bench/ctx_quick_refetch.py --show
```

Raw rows: `results/ctx/raw/{base,d3,d3-27b}.jsonl`. Per-run decision logs, diffs and pi stderr
(also of the superseded and invalid runs): `tar -xJf results/ctx/raw-artifacts.tar.xz -C results/ctx`.
The pi sessions (full transcripts) are in `~/.cache/native-harness/ctx-sessions` on the benchmark
host, outside the repo; the superseded d3 runs' sessions were overwritten by the re-run.
