# The load report overstates peaks

`computeMaxLoad` in `sweep.ts` finds the peak load of a set of weighted reservations and the
time spans where that peak holds. The capacity team says the peaks it reports are often too
high, and the span lists look odd. Repair it; keep the export and the return shape.

`computeMaxLoad(intervals)` takes a list of `[start, end, weight]` reservations:

- each reservation covers the half-open range `[start, end)`; `start` and `end` are integers
  (they may be negative), `weight` is a positive integer;
- a reservation with `end < start` is invalid: throw an `Error`;
- a zero-length reservation (`start === end`) covers nothing and must be ignored entirely;
- the load at a point is the sum of the weights of the reservations covering it.

It returns `[maxLoad, spans]`: the greatest load at any point, and the sorted list of maximal
half-open `[from, to)` spans where the load equals `maxLoad`. Spans that touch (one ends where
the next starts) and carry the same load are one span. No reservations (or only zero-length
ones) returns `[0, []]`.

Run the tests with: `node --test tests/`
