Add `daysBetween(from: Day, to: Day): number` in `src/daysBetween.ts`: the number of calendar days
from `from` to `to` (negative when `to` is earlier, 0 for the same day). It must be exact across
daylight-saving changes. Bad day strings throw the usual `INVALID_DAY` error.

It is part of the public API.
