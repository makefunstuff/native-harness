# verify-gate bench

| arm | model | runs | hidden tests pass | timed out | own tests green, hidden fail | gate sent back | then passed | gave up | median wall s | median turns | output tok/run |
|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-plain-base | anthropic/claude-sonnet-5-5 | 27 | 27/27 (100%) | 0 | 0/27 (0%) | 0 | 0/0 | 0 | 14 | 3 | 1584 |
| claude-plain-gate | anthropic/claude-sonnet-5-5 | 27 | 27/27 (100%) | 0 | 0/27 (0%) | 0 | 0/0 | 0 | 14 | 3 | 1599 |
| claude-told-base | anthropic/claude-sonnet-5-5 | 27 | 27/27 (100%) | 0 | 0/27 (0%) | 0 | 0/0 | 0 | 12 | 3 | 1513 |
| claude-told-gate | anthropic/claude-sonnet-5-5 | 27 | 27/27 (100%) | 0 | 0/27 (0%) | 0 | 0/0 | 0 | 13 | 3 | 1531 |
| deepseek-plain-base | deepseek/deepseek-flash | 33 | 33/33 (100%) | 0 | 0/33 (0%) | 0 | 0/0 | 0 | 18 | 7 | 3465 |
| deepseek-plain-gate | deepseek/deepseek-flash | 33 | 33/33 (100%) | 0 | 0/33 (0%) | 0 | 0/0 | 0 | 17 | 7 | 3414 |
| deepseek-told-base | deepseek/deepseek-flash | 33 | 33/33 (100%) | 0 | 0/33 (0%) | 0 | 0/0 | 0 | 18 | 6 | 3413 |
| deepseek-told-gate | deepseek/deepseek-flash | 33 | 32/33 (97%) | 0 | 1/33 (3%) | 0 | 0/0 | 0 | 18 | 7 | 3635 |
| local-27b-plain-base | llama.cpp/qwen3.8-27b:medium | 11 | 10/11 (91%) | 0 | 1/11 (9%) | 0 | 0/0 | 0 | 67 | 9 | 7773 |
| local-27b-plain-gate | llama.cpp/qwen3.8-27b:medium | 5 | 5/5 (100%) | 0 | 0/5 (0%) | 0 | 0/0 | 0 | 52 | 7 | 3875 |

Prompt cache (local model: share of prompt tokens the server did not have to re-read):

| arm | prompt tokens from cache, all requests | requests right after a gate message: from cache |
|---|---|---|
| local-27b-plain-base | 94% | – |
| local-27b-plain-gate | 91% | – |

Hidden tests passed, per task:

| task | claude-plain-base | claude-plain-gate | claude-told-base | claude-told-gate | deepseek-plain-base | deepseek-plain-gate | deepseek-told-base | deepseek-told-gate | local-27b-plain-base | local-27b-plain-gate |
|---|---|---|---|---|---|---|---|---|---|---|
| api-migration | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 | 0/1 | 1/1 |
| cli-json | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1/1 | 1/1 |
| config-rename | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1/1 | 1/1 |
| duration | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1/1 | 1/1 |
| event-reconcile | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1/1 | 1/1 |
| isoweek | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1/1 | – |
| logstats | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1/1 | – |
| presets-ini | – | – | – | – | 3/3 | 3/3 | 3/3 | 3/3 | 1/1 | – |
| schedule-repair | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1/1 | – |
| sqlite-migration | – | – | – | – | 3/3 | 3/3 | 3/3 | 3/3 | 1/1 | – |
| ttlcache | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1/1 | – |
