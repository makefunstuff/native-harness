Add `endOfMonth(day: Day): Day` and `isLastDayOfMonth(day: Day): boolean` in `src/monthEnd.ts`.
`endOfMonth` returns the last day of the month `day` is in (leap years included); bad day strings
throw the usual `INVALID_DAY` error.

They are part of the public API.
