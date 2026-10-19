Repair `computeMaxLoad` in `src/sweep.ts`. Keep the API exactly:

    computeMaxLoad(intervals: Array<[start, end, weight]>): { maxLoad: number; spans: Array<[number, number]> }

- Intervals are half-open `[start, end)`; `start`/`end` are integers (may be negative), `weight`
  is a positive integer.
- Throw a `RangeError` for any interval with `end < start`; ignore zero-length intervals
  (`start === end`) entirely.
- `maxLoad` is the greatest summed weight at any point; `spans` is the sorted list of maximal
  half-open spans that carry exactly `maxLoad`, with adjacent spans of that load merged into one.
- Empty input, or only zero-length intervals, returns `{ maxLoad: 0, spans: [] }`.

Known bugs: an interval ending where another starts inflates the load, zero-length intervals add
load, and adjacent spans are not merged. Fix only what is needed; do not rename the function or
change the return shape. Write tests for your fix in tests/.
