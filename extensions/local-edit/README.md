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
| **tolerant matching** | when `oldText` is not found exactly (or by pi's own fuzzy match), it is placed when exactly one spot fits: 1. the same text with literal `\n`/`\t` decoded; 2. the same lines with indentation ignored; 3. a window of whole lines (same count, ±1) that is **≥ 0.95 similar** (Levenshtein ratio on whitespace-normalised text), with no other non-overlapping window reaching 0.95, and first and last lines that each look alike (≥ 0.8), so a partial line is not swallowed; a one-line `oldText` may also match part of a line. `newText` is re-indented from the model's indentation to the file's. Two or more candidates means no edit, and the error lists their line numbers. |
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
line 5 (55% similar):
5|     return s
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

RESULTS_PLACEHOLDER

## Files

- `index.ts`: the tool: argument repair, path repair, matching, then pi's own edit, then the diff.
- `match.ts`: tolerant matching and candidate search (pure functions).
- `diff.ts`: the compact diff and the dropped-code warnings.
- `paths.ts`: path repair, and the search for the text in other files.
- `index.test.ts`: unit tests. `local-edit.smoke.mjs`: an end-to-end `pi -p` run with the
  package installed from git, against the mock model.
- `bench/`: `run.py` and `run-all.sh` (live tickets), `replay.mjs` (offline replay of real
  sessions), `gen_tasks.py` (the edit-heavy tickets in `bench/tasks/`), `report.py`, and the
  `results/`.
