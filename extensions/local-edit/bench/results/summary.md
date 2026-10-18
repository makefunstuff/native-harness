# local-edit bench results

| arm | model | runs | hidden tests pass | edit calls | edit errors | error kinds | placed loosely | paths repaired | edits dropping ≥3 lines | untouched-code check failed | collateral lines | median wall s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cloud-base | deepseek/deepseek-flash | 7 | 7/7 (100.0%) | 2 | 0/2 (0.0%) | – | 0 | 0 | 0 | 0/0 | 1 | 12 |

## Per ticket

| task | cloud-base pass · edit errors/calls |
|---|---|
| bulk-rename | 1/1 · 0/1 |
| cli-json | 1/1 · 0/0 |
| config-rename | 1/1 · 0/1 |
| logstats | 1/1 · 0/0 |
| presets-ini | 1/1 · 0/0 |
| sqlite-migration | 1/1 · 0/0 |
| ttlcache | 1/1 · 0/0 |
