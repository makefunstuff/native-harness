# native-harness

An experiment: run the agent harness **inside** the model runtime instead of talking to it over HTTP.

Agent harnesses (pi, Claude Code, Codex…) drive a model through an OpenAI-style API. The runtime (llama.cpp here) only
sees one request at a time and knows nothing about the loop around it. Putting the harness loop in the same process as
llama.cpp gives it direct access to the KV cache, logits, sampling and every loaded model, which may allow:

- **dynamic context tuning**: keep, drop, summarise or reorder parts of the context in the KV cache between steps,
  instead of resending and re-processing whole prompts;
- **several models at once**: a small model drafts, routes or summarises while a large one reasons, sharing memory and
  cache;
- **decision models**: use classifier-style calls (logprobs over a few choices) for cheap routing and tool decisions;
- **no network round trip** between harness and model, and no re-tokenising of the whole conversation each turn.

If the results are good, this is how local inference on our machines would be done natively.

Status: just started.
