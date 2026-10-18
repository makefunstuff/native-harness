Write two modules in `src/`:

- `src/protocol.ts`: event validation.
  - `export class EventError extends Error`.
  - `validateEvent(event: unknown)` throws `EventError` when: the event is not an object; `key`
    is missing or not a string; `revision` is missing, not an integer, or negative; `operation`
    is not `"put"` or `"delete"`; a `put` has no `value` property. Otherwise it returns the event.
- `src/reconcile.ts`: the reducer.
  - `reduceEvents(events, state = {})` returns a new state object (key -> value).
  - Each event is `{ key, revision, operation, value? }`. Events may refer to keys not yet in
    the state.
  - For the same key, the event with the greatest revision wins; equal revisions are broken by
    the last occurrence in the input (later in the list wins). `put` sets `state[key] = value`;
    `delete` removes the key.
  - Never mutate the input events, their values, or the input state. The returned state shares
    no objects with the input (nested values are deep copies).
  - Empty input returns an equal, fresh copy of the input state.
  - Every event is validated first; if any event is invalid, `EventError` is thrown and nothing
    is changed.

Values are JSON data (objects, arrays, strings, numbers, booleans, null). No dependencies.
Write tests for your work in tests/.
