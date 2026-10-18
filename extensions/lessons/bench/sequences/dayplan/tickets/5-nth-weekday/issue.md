Add `nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Day` in
`src/nthWeekday.ts`: the `n`-th given weekday of a month, e.g. the second Tuesday of March 2026 is
`nthWeekdayOfMonth(2026, 3, 2, 2)`. `month` is 1–12, `weekday` is 0 (Sunday) to 6 (Saturday),
`n` is 1–5, or -1 for the last one. When the month has no such day (a fifth Monday that does not
exist), throw a `DayError` with code `NO_SUCH_DAY`.

It is part of the public API.
