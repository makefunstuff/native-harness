# Results: d3 context management (HRN-2)

## Verdict

**No. Letting d3 manage the context did not help the agent solve more, and it made the runs more
expensive.** It is not worth taking further in this form.

- **Solve rate: no difference, and none was possible.** deepseek-flash solved every run in every arm
  (base 22/22, d3-flash 22/22, d3 27B 4/4). The tickets were too easy for this model to show a
  difference in solve rate.
- **It does shrink the context.** On the two long bundled tickets (the only sessions that got close
  to the 128k window) d3-flash cut:
  - tokens processed by 32% (10.2M → 7.0M);
  - the median per-request context by 38% (62k → 38k);
  - the median peak context from 114k to 82k;
  - pi's own compactions from 5 to 1.

  On the nine single tickets, which peak at 20-60k, it saved 3% of tokens.
- **It costs more money.** Total cost was +44% (all 22 runs: $0.71 → $1.03), +55% on the bundles
  and +31% on the single tickets. Every edit in the middle of the transcript breaks DeepSeek's
  prefix cache, and a cache miss costs 50× a cache hit ($0.30 vs $0.006 per M tokens). d3-flash
  doubled the cache-miss input (1.21M → 2.40M), which cost $0.35 more. The cheaper reads saved
  $0.03.
- **It forgets things.** d3-flash said "drop" for 75% of the items it judged, with a median
  confidence of only 0.59. Its "keep" answers sat at p ≈ 0.50. In the transcripts I count about 13
  cases in 6 of 22 runs where the agent fetched again, within 1-3 turns, something d3 had just
  removed while it was still working on it. The clearest one is release-b round 1, which re-read
  the config spec over and over. No run failed because of it; it cost extra turns and cache misses.
- **The 27B d3 is not better here.** It made more varied choices (drop 60%, summarise 22%) and
  forgot less (2-3 cases in 4 runs). But each call took ~2 s instead of ~0.45 s, so it got through
  only 19 checks in four runs. The result: bundle tokens −14%, cost +42%. The weak link is not the
  judge's quality but editing a cached prefix at all.
- **d3 latency adds no wall time** in this design (decisions run in the background and apply at the
  next request; wall time was 22.9 vs 22.4 min in total). It costs GPU time, though: d3-flash was
  busy for 45% of the agents' wall time, the 27B for 80%.
- **Where it hurt:** release-b (cost ×2.0), prod-incidents (×1.7), wide-rename (×1.65) and
  legacy-report (×1.5). **Where it helped:** issue-triage (−34% tokens, −19% cost), and
  ci-triage/etl-pipeline (about even).

**The data is thin.**
- There are 2 runs per ticket and arm, and run-to-run spread is large: base release-b processed
  3.2M tokens in one run and 1.8M in the other.
- Only 2 tickets (8 runs per arm) reach real context pressure.
- The 27B arm is 4 runs.
- The direction of the cost result is robust: the cache-miss arithmetic explains it, and it shows
  up in most tickets. Its size is not.
- The token savings on the bundles are larger than the run-to-run spread, but rest on 4 runs per
  arm.

**If it is taken further at all:** stop editing the middle of the context. Use d3 only where an
edit is free or unavoidable:
- at the moment pi compacts anyway (choose *when* to compact: at a subtask boundary, instead of when
  the window is full);
- to choose *what* survives the compaction (pins).

Even then, it is only worth it with a provider or local server where a re-read costs about the same
as a cached read, or when sessions really overflow the window. Neither was the case here. The
decision quality of d3-flash would also need fitting first. These transcripts give labels for that
for free: "removed, then fetched again" is a wrong drop.

## What was run

- **Agent:** stock pi 1.3.0 with the owner's configuration, using a copy of `~/.pi/agent` (made by
  `LINK_NATIVE=0 scripts/make-pi-agent-copy.sh ~/.cache/native-harness/pi-agent-d3`), model
  `deepseek/deepseek-flash:medium` via DeepSeek's own API. The key is read by pi the way it always
  is; nothing was printed or stored. Both arms ran the same pi, model, thinking level and limits
  (40 min timeout; pi's default compaction at window − 16k), at the same time, 3 runs per arm in
  parallel.
- **Context manager (`d3` arm):** `extension/d3-context/index.ts`, loaded with `pi -e`. It works in
  pi's `context` hook, which rewrites each request without touching the session file:
  - It considers every tool output, file read and old assistant turn of at least 1,500 characters
    that is older than the newest 2 turns.
  - Every 2 turns it asks d3 two things: is the agent at a subtask boundary, and should each item be
    kept, summarised or dropped?
  - For items to remove, a further question per key line (paths, errors, failing tests, values)
    decides which lines are pinned.
  - Decisions are applied at a boundary (p ≥ 0.5). As a fallback they are also applied when the
    context is estimated at ≥ 80k tokens and the edit saves at least 4,000 characters.
  - A drop becomes a stub holding its pinned lines. A summary is extractive: head, tail, key lines
    and pins (d3 does not write text).
  - Edits are sticky, so the prefix is stable between edits.
  - Every decision is logged with its probabilities (`results/ctx/raw-artifacts.tar.xz`, `*.d3.jsonl`).
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
    sessions: 23-56 turns, peak context 60-124k.
- **Runs:** each ticket 2× per arm (rounds 1-2). Round 0 was a pilot while the extension was being
  written; it is in the raw rows and excluded from every table.
- **Measures:** `bench/ctx_run.py` (per-run rows from pi's session usage and the extension log),
  `bench/ctx_report.py` (→ `results/ctx/summary.md`), and `bench/ctx_forgot.py` /
  `bench/ctx_quick_refetch.py` (candidates for "forgot something", then read by hand). Cost is at
  deepseek-flash peak list prices (cache hit $0.006, miss $0.30, output $1.20 per M), the same for
  every run.

## Numbers

All runs (base and d3: 22 each; d3-27b: the 4 bundle runs only, so its column is not comparable
with the others; see the bundle table):

| | base | d3-flash |
|---|---|---|
| solved | 22/22 | 22/22 |
| tokens processed (M) | 16.10 | 12.72 |
| … cache-miss / cache-hit input (M) | 1.21 / 14.67 | 2.40 / 10.11 |
| cost (USD) | 0.711 | 1.025 |
| mean context per request, median of runs | 31.1k | 28.2k |
| peak context, median / max | 38.8k / 123.7k | 38.6k / 114.1k |
| turns, median / total | 13 / 380 | 13 / 413 |
| wall time, median / total | 39 s / 22.4 min | 45 s / 22.9 min |
| d3 calls, median latency (p90) | – | 904, 0.44 s (1.15 s) |
| edits applied (at a boundary / under pressure) | – | 40 / 33 |
| items dropped / summarised | – | 239 / 15 |

The two bundled tickets (4 runs per arm):

| | base | d3-flash | d3 27B |
|---|---|---|---|
| solved | 4/4 | 4/4 | 4/4 |
| tokens processed (M) | 10.17 | 6.96 | 8.79 |
| cache-miss input (M) | 0.71 | 1.56 | 1.32 |
| cost (USD) | 0.384 | 0.597 | 0.546 |
| peak context, median | 114k | 82k | 109k |
| mean context per request, median | 62k | 38k | 57k |
| turns, total | 164 | 185 | 148 |
| wall time, total | 626 s | 564 s | 626 s |
| pi compactions | 5 | 1 | 4 |
| d3 busy time | – | 340 s | 501 s |

Per ticket: `results/ctx/summary.md`.

### "Forgot something it needed"

No agent message ever mentioned a removal, and no identical tool call was repeated after a removal
more than twice in 22 runs. The forgetting shows up as re-fetching. Removed file outputs re-read
within 3 turns:
- d3-flash: 24 of 156 (15%);
- 27B: 8 of 42 (19%);
- base, for comparison: 31% of all file reads are re-read within 3 turns anyway.

So most re-reads are normal working style (narrower `sed -n` ranges, verification). Reading these
candidates by hand, about 13 (flash) and 2-3 (27B) are real "removed, then needed" cases:
- release-a r1 dropped `docs/behaviour.md` and the billing modules at turn 20 and re-read both at
  turns 21-22;
- release-b r1 dropped `report.py` twice while still fixing it, and dropped each section of
  `docs/config-spec.md` while still implementing it, then re-read them (turns 33-50);
- prod-incidents r2 dropped the behaviour doc twice while the agent was still applying it;
- the 27B in release-b r2 dropped the spec plus `validate.py`, and the agent re-ran exactly the same
  `cat` in the next turn.

None of these made a ticket fail.

## Why it costs more

An edit at position p turns every later token of the next request from a cache hit into a miss.
Removing X tokens saves X × (hit price) on each later request, and costs about the suffix length
S × (miss − hit) once. With DeepSeek's 50:1 price ratio, an edit pays for itself only after about
49·S/X more requests. Here S ≥ X, and whole sessions are 10-56 requests long, so edits essentially
never pay on price.

They do pay on tokens processed and on context size, which is what a local llama.cpp server or a
model with a small window would care about. But HRN-1 found that on its hybrid local model an edit
forces a recompute of everything after it as well. Checks at subtask boundaries, as asked, keep
edits rarer (40 of 73 applies were at a boundary). That still meant an edit every ~4 turns on the
bundles.

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
  turn or two later than its decision.
- **The router's `vllm-d3` (27B) preset cannot answer these requests.** With `ubatch-size = 512`,
  every state longer than 512 tokens fails ("input is too large to process"), because a
  non-causal pass needs the whole input in one ubatch. The first 4 runs of the 27B arm were invalid
  for this reason; they are kept in `results/ctx/invalid/`. The 27B then ran with ubatch 2048 and
  without the vision projector; ubatch 4096 ran out of memory on the two 16 GB cards.
- **DeepSeek reads files with `cat`/`sed` in bash, not pi's `read` tool.** It also prefixes nearly
  every command with `cd <work dir> &&`; the extension strips that from its labels.
- **The benchmarked ticket repos contained stray `__pycache__/*.pyc` files**, written when the
  generator imported them to compute expected values (one agent noticed them in `git status`).
  Both arms had the same files. The generator no longer writes them, and its output is otherwise
  identical.
- **Ten tickets were planned.** I wrote nine single tickets plus the two bundles. In the pilot
  every single ticket was solved in 20-110 s at a peak of 20-56k, so the bundles are what gives
  context pressure.

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

Raw rows: `results/ctx/raw/{base,d3,d3-27b}.jsonl`. Per-run decision logs, diffs and pi stderr:
`tar -xJf results/ctx/raw-artifacts.tar.xz -C results/ctx`. The pi sessions (full transcripts) are
in `~/.cache/native-harness/ctx-sessions` on the benchmark host, outside the repo.
