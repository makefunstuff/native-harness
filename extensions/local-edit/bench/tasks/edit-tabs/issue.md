`src/jobs.ts` (tab-indented; keep it that way) needs three changes. Do not touch anything else.

1. `Scheduler.tick` must stop calling a job after it has failed 3 times in a row: count
   consecutive failures per job (reset on success) and skip the job once the count reaches 3.
   Failures are still logged as they are now.
2. `Scheduler.remove` of an unknown name must throw `new Error("no job <name>")`.
3. `report7` must also list jobs that are due, whatever their period: a job is listed when its
   period is a multiple of 9 OR it is due now.

Add tests to `tests/jobs.test.ts`. Run them with: node --test tests/*.test.ts
