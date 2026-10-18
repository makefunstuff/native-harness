`jobs.py` (tab-indented; keep it that way) needs three changes. Do not touch anything else.

1. `Scheduler.tick` must stop calling a job after it has failed 3 times in a row: count
   consecutive failures per job (reset on success) and skip the job once the count reaches 3.
   Failures are still logged as they are now.
2. `Scheduler.remove` of an unknown name must raise `KeyError("no job <name>")` with that message.
3. `report_7` must also include jobs that are due, whatever their period: a job is listed when
   its period is a multiple of 9 OR it is due now.

Add tests to `tests/test_jobs.py`. Run them with: python3 -m unittest discover -s tests
