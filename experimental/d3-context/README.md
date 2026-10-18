# d3-context (experimental)

> **Experimental extra of [pi-extras](../../README.md), not part of the package manifest.** It
> needs a local vllm-d3 decision model served over the System One wire (`D3_URL`), and without
> `D3_URL` it does nothing. Commands below run from this folder (`experimental/d3-context/`).
> Task HRN-2.

**Question:** does letting a decision model manage the agent's context make the agent solve more,
or waste less?

**Answer, from an A/B with deepseek-flash as the agent:** no.
- The solve rate was the same: every run passed in every arm.
- On the long sessions the tokens processed fell by only 10%, within run-to-run noise.
- Cost per run was 57-76% higher, because every edit in the middle of the context breaks the
  provider's prefix cache.

Details and numbers: [RESULTS.md](RESULTS.md).

## What the extension does

`extension/index.ts`, loaded with `pi -e extension/index.ts` (pi's `context` hook, so the session
file is never changed):

- Every 2 turns it asks the d3 model, in the background, whether the agent is at a subtask
  boundary, and whether each large old item should be kept, summarised or dropped. Items are tool
  outputs, file reads and old assistant turns. For each item it removes, it also asks which key
  lines (paths, errors, failing tests, values) to pin.
- It applies the decisions at a boundary. As a fallback it also applies them when the request as
  actually sent passes `D3_PRESSURE` tokens.
- A dropped item becomes a stub; a summarised one keeps its head, tail and key lines. The pinned
  lines go into one shared notes block on the newest message.
- Every decision is logged with its probabilities to `D3_LOG`.

The settings are documented in the file header.

## Layout

| path | what |
|---|---|
| `extension/index.ts`, `extension/index.test.ts` | the extension and its unit test (`npm test` at the repo root) |
| `bench/gen_long_tasks.py` | generates `bench/tasks-long/`: 9 long tickets plus 2 bundles of four, with hidden tests (not committed) |
| `bench/selftest.sh` | the broken repo fails the hidden tests; repo + reference fix passes them |
| `bench/ctx_run.py` | runs an arm (`base`, `d3`, `d3-27b`) with pi + deepseek-flash, one row per run |
| `bench/ctx_report.py` | → `results/summary.md` |
| `bench/ctx_forgot.py`, `bench/ctx_quick_refetch.py` | candidates for "forgot something it needed" |
| `scripts/pi.sh`, `scripts/make-pi-agent-copy.sh` | pi on a copy of `~/.pi/agent` (nothing in the real one is edited) |
| `scripts/check.sh` | the experiment's check (no GPU, no model), run by the top-level `scripts/check.sh` |
| `results/` | per-run rows, the summary, and an archive of the decision logs, diffs and stderr |

## Run

```bash
python3 bench/gen_long_tasks.py && bash bench/selftest.sh
scripts/make-pi-agent-copy.sh
export D3_URL=http://127.0.0.1:18190/v1      # a llama-server serving vllm-d3-flash (see RESULTS.md)
python3 bench/ctx_run.py base --rounds 2 --jobs 3 & python3 bench/ctx_run.py d3 --rounds 2 --jobs 3
python3 bench/ctx_report.py
```
