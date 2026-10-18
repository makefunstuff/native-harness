# local-edit bench results

| arm | model | runs | hidden tests pass | edit calls | edit errors | error kinds | placed loosely | paths repaired | edits dropping ≥3 lines | untouched-code check failed | collateral lines | median wall s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cloud-base | deepseek/deepseek-flash | 18 | 18/18 (100.0%) | 30 | 1/30 (3.3%) | arguments 1 | 0 | 0 | 3 | 0/18 (0.0%) | 9 | 11 |
| cloud-local-edit | deepseek/deepseek-flash | 18 | 18/18 (100.0%) | 26 | 0/26 (0.0%) | – | 0 | 0 | 0 | 0/18 (0.0%) | 10 | 12 |
| local-base | llama.cpp/qwen3.8-27b:medium | 2 | 2/2 (100.0%) | 4 | 0/4 (0.0%) | – | 0 | 0 | 0 | 0/2 (0.0%) | 1 | 240 |
| local-local-edit | llama.cpp/qwen3.8-27b:medium | 2 | 2/2 (100.0%) | 4 | 0/4 (0.0%) | – | 0 | 0 | 0 | 0/2 (0.0%) | 1 | 269 |

## Per ticket

| task | cloud-base: pass · edit errors/calls | cloud-local-edit: pass · edit errors/calls | local-base: pass · edit errors/calls | local-local-edit: pass · edit errors/calls |
|---|---|---|---|---|
| edit-handlers | 6/6 · 0/12 | 6/6 · 0/12 | 1/1 · 0/2 | 1/1 · 0/2 |
| edit-table | 6/6 · 0/9 | 6/6 · 0/7 | 1/1 · 0/2 | 1/1 · 0/2 |
| edit-tabs | 6/6 · 1/9 | 6/6 · 0/7 | – | – |
