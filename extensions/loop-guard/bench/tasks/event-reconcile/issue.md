Write two modules in this directory (TypeScript, Node standard library only):

- `protocol.ts`: event validation.
  - `export class EventError extends Error`.
  - `export function validateEvent(event)` throws `EventError` when: `key` is missing;
    `revision` is absent, not an integer (booleans are not numbers), or negative; `operation`
    is not `"put"` or `"delete"`; a `put` has no `value` key. Returns the event.
- `reconcile.ts`: the reducer.
  - `export function reduceEvents(events, state = {})` returns a new state object.
  - Each event is `{ key, revision, operation, value? }`. The state maps key -> value. Events
    may reference keys not yet in the state.
  - For the same key, the event with the **greatest revision wins**; equal revisions are broken
    by **last occurrence** in the list. `put` sets `state[key] = value`; `delete` removes the key.
  - Never mutate the input list or any input value; return a fresh state whose nested values are
    not shared with the inputs (deep copies).
  - Empty input returns an equal, fresh copy of the input state.
  - Call `validateEvent` for every event; any invalid event throws `EventError` and nothing is
    changed.

Deterministic, no global state.
