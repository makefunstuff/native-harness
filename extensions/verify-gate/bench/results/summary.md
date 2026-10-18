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

Hidden tests passed, per task:

| task | claude-plain-base | claude-plain-gate | claude-told-base | claude-told-gate | deepseek-plain-base | deepseek-plain-gate | deepseek-told-base | deepseek-told-gate |
|---|---|---|---|---|---|---|---|---|
| api-migration | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 |
| cli-json | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| config-rename | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| duration | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| event-reconcile | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| isoweek | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| logstats | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| presets-ini | – | – | – | – | 3/3 | 3/3 | 3/3 | 3/3 |
| schedule-repair | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| sqlite-migration | – | – | – | – | 3/3 | 3/3 | 3/3 | 3/3 |
| ttlcache | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
