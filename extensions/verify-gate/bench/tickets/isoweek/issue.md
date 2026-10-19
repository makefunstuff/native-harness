Weekly reports group days by ISO 8601 week, and `src/isoweek.ts` gets the weeks around New Year
wrong. Fix both functions:

- `isoWeek(date: Date): { year: number; week: number }`: the ISO 8601 week-numbering year and
  week of the date, using its UTC calendar day. ISO weeks start on Monday; week 1 is the week that
  contains the year's first Thursday. So the last days of December can belong to week 1 of the
  next year, and the first days of January to week 52 or 53 of the previous year.
- `weeksInYear(year: number): number`: how many ISO weeks that ISO year has (52 or 53).
- `formatWeek(date)` keeps its format, e.g. `2026-W07`.

Write tests for your fix in tests/.
