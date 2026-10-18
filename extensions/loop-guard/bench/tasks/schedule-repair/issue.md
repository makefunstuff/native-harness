`computeMaxLoad` in `sweep.ts` gives wrong answers. Repair it and keep the API exactly:

    computeMaxLoad(intervals: Array<[start, end, weight]>): [maxLoad, spans]

- Intervals are half-open `[start, end)`; `start`/`end` are integers (may be negative),
  `weight` is a positive integer.
- An interval with `end < start` throws a RangeError; zero-length intervals (`start == end`)
  are ignored entirely.
- Return `[maxLoad, spans]`: `maxLoad` is the greatest summed weight at any point, `spans` the
  sorted list of maximal half-open `[start, end]` spans that carry exactly `maxLoad`, with
  adjacent spans of that load merged into one.
- Empty input, or only zero-length intervals, returns `[0, []]`.

Change only what is needed to make the sweep correct: an interval ending where another starts
must not inflate the load at the join, and adjacent max-load spans must merge.
Run the tests with: node --test tests/*.spec.ts
