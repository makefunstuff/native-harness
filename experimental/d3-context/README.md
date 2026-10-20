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
| `bench/gen-long-tasks.ts`, `bench/long-tasks/` | generates `bench/tasks-long/`: 11 long tickets with hidden outcome tests (generated data, not committed) |
| `../../../bench/run.ts --bench d3-context` | the runs: the `base` and `d3` arms on the long tickets, pi in-process, one row per run (the shared bench) |
| `bench/context-report.ts` | → `results/context.md`: the context, the compactions, the re-reads, and what the router saved, per arm and task |
| `bench/forgot.ts`, `bench/quick-refetch.ts` | candidates for "forgot something it needed": an output the router removed whose file is read again |
| `bench/lib/log.ts` | reading of the extension's own decision log (`D3_LOG`) |
| `scripts/check.sh` | the experiment's check (no GPU, no model), run by the top-level `scripts/check.sh` |
| `results/` | the recorded rows, the summary of those runs, `context.md`, and an archive of the decision logs, diffs and stderr |

## Run

```bash
node experimental/d3-context/bench/gen-long-tasks.ts             # the long tickets (bench/tasks-long)
node bench/selftest.ts --tasks-root experimental/d3-context/bench/tasks-long
export D3_URL=http://127.0.0.1:18190/v1   # a llama-server serving vllm-d3-flash (see RESULTS.md)
node bench/run.ts --bench d3-context --arms base --rounds 2 --workers 3
node bench/run.ts --bench d3-context --arms d3   --rounds 2 --workers 3
node experimental/d3-context/bench/context-report.ts
node experimental/d3-context/bench/quick-refetch.ts --show
```

pi runs in-process through its SDK (`bench/lib/pi.ts`), so both arms share one process: the
extension is configured per run (`d3Context(pi, cfg)`, with `D3_LOG` per run) rather than read from
the environment once at import. `D3_MODEL` picks the small model, `--model` the agent's.

The rows recorded in `results/` (the runs of February 2026, read them in `RESULTS.md`) were measured
by this experiment's earlier Python scripts. Those are gone; the files above are their equivalents,
and the rows, tables and decision logs of those runs are kept as data.
