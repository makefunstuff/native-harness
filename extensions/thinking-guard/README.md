# thinking-guard

Stops runaway thinking. Local models sometimes think for minutes before they act: turns of
46-58k characters of thinking, such as decoding packet bytes by hand, at 24-27 tok/s. That is where
users give up and abort: 2.4% of local turns are aborted by the user, against 0.6% on cloud models.

thinking-guard caps a reply's thinking and makes the model act instead:

1. **Thinking budget (llama.cpp).** For a llama.cpp server, every request gets a thinking budget
   (`thinking_budget_tokens`, default 3000 tokens, about 8k characters) and a short message the
   server inserts when the budget runs out: *"I have deliberated long enough. I stop thinking now
   and act: my next step is a tool call that checks or changes something, or the answer."* The
   server then closes the thinking block and the model goes on to a tool call. Nothing is aborted
   and nothing is re-sent.
2. **Abort and re-issue (fallback).** When a reply's thinking passes 8000 characters (16000 when a
   budget was sent, in case the server ignores it), the reply is aborted and the request issued
   again with a note appended: *"[thinking-guard] Your previous reply was stopped after N characters
   of thinking without an action. Stop deliberating. Take the next concrete step now with a tool
   call…"*. At most 2 aborts per user prompt; after that the model may think as long as it wants.

Both are **append-only**, so the prompt cache of hybrid models (Qwen 3.8 27B) survives: the
budget changes sampling, not the prompt; pi drops aborted replies from the context, so the
re-issued request is the previous one plus the note.

By default only **local models** are guarded: models on loopback or a private network
(10/8, 172.16/12, 192.168/16, 100.64/10, `*.local`, `*.lan`, single-label hosts…) and the
in-process `llama-native` provider. The budget is only sent where `GET /props` answers like
llama-server (or its router); the result is cached per server.

## Does our llama.cpp honour a per-request thinking budget?

Yes, with the right field name. Checked on the router (llama.cpp `b3411-77c4540ce`, Qwen 3.8 27B,
a "count the primes between 1000 and 1100" prompt):

| request field | thinking | answer |
|---|---:|---|
| none | 9459 chars, still thinking at `max_tokens` 6000 | none |
| `thinking_token_budget: 256` (vLLM's name; pi's `compat.supportsThinkingTokenBudget`) | 7921 chars: **ignored** | 16 (right) |
| `reasoning_budget_tokens: 256` | 550 chars: cut | "7" (wrong, answers at once) |
| `thinking_budget_tokens: 256` + `reasoning_budget_message` | 454 chars: cut, message inserted | keeps working it out in the visible answer |

- llama-server reads `thinking_budget_tokens` or `reasoning_budget_tokens`, plus
  `reasoning_budget_message`, per request (`tools/server/server-common.cpp`). It ignores
  `thinking_token_budget`, the field pi sends with `compat.supportsThinkingTokenBudget: true`.
- pi can send the right field itself (`compat.thinkingTokenBudgetField: "thinking_budget_tokens"`
  in models.json), but then the budget comes from the thinking level and no message is sent. A cut
  without a message makes the model answer immediately, and wrongly in the probe above. With the
  message the model closes its thinking and acts. So thinking-guard sends both, and keeps a budget
  pi already set (it only adds the message then).

## Settings

Defaults, then `~/.pi/agent/thinking-guard.json` (or the file `PI_THINKING_GUARD_CONFIG` names),
then environment variables:

| key | env | default | |
|---|---|---|---|
| `enabled` | `PI_THINKING_GUARD_ENABLED` | `true` | |
| `scope` | `PI_THINKING_GUARD_SCOPE` | `"local"` | `"all"` guards cloud models too (abort only; no budget for them) |
| `maxThinkingChars` | `PI_THINKING_GUARD_MAX_CHARS` | `8000` | abort past this without a budget; `0` disables the abort |
| `budget` | `PI_THINKING_GUARD_BUDGET` | `"auto"` | `"auto"`: llama.cpp servers; `"on"`: every guarded `openai-completions` model; `"off"` |
| `budgetTokens` | `PI_THINKING_GUARD_BUDGET_TOKENS` | `3000` | local Qwen thinking runs at ~2.7 chars/token |
| `budgetField` | | `"thinking_budget_tokens"` | |
| `budgetMessage` | | see above | inserted by llama.cpp when the budget runs out |
| `fallbackChars` | `PI_THINKING_GUARD_FALLBACK_CHARS` | `16000` | abort threshold when a budget was sent |
| `maxRetries` | `PI_THINKING_GUARD_MAX_RETRIES` | `2` | aborts per user prompt |
| `note` | | see above | appended after an abort; `{chars}` is replaced |

`/thinking-guard` shows the settings, whether the current model is guarded and gets a budget, and
what the guard did in this session; `/thinking-guard off` and `on` toggle it for the session. Every
abort and budget stop is recorded in the session as a `thinking-guard` custom entry (not sent to
the model).

RESULTS_PLACEHOLDER
