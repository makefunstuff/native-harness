# verify-gate bench

| arm | model | runs | hidden tests pass | timed out | own tests green, hidden fail | gate sent back | then passed | gave up | median wall s | median turns | output tok/run |
|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-base | anthropic/claude-sonnet-5-5 | 27 | 27/27 (100%) | 0 | 0/27 (0%) | 0 | 0/0 | 0 | 12 | 3 | 1513 |
| claude-gate | anthropic/claude-sonnet-5-5 | 27 | 27/27 (100%) | 0 | 0/27 (0%) | 0 | 0/0 | 0 | 13 | 3 | 1531 |
| deepseek-base | deepseek/deepseek-flash | 27 | 27/27 (100%) | 0 | 0/27 (0%) | 0 | 0/0 | 0 | 17 | 6 | 3372 |
| deepseek-gate | deepseek/deepseek-flash | 27 | 26/27 (96%) | 0 | 1/27 (4%) | 0 | 0/0 | 0 | 18 | 6 | 3520 |

Hidden tests passed, per task:

| task | claude-base | claude-gate | deepseek-base | deepseek-gate |
|---|---|---|---|---|
| api-migration | 3/3 | 3/3 | 3/3 | 2/3 |
| cli-json | 3/3 | 3/3 | 3/3 | 3/3 |
| config-rename | 3/3 | 3/3 | 3/3 | 3/3 |
| duration | 3/3 | 3/3 | 3/3 | 3/3 |
| event-reconcile | 3/3 | 3/3 | 3/3 | 3/3 |
| isoweek | 3/3 | 3/3 | 3/3 | 3/3 |
| logstats | 3/3 | 3/3 | 3/3 | 3/3 |
| schedule-repair | 3/3 | 3/3 | 3/3 | 3/3 |
| ttlcache | 3/3 | 3/3 | 3/3 | 3/3 |
