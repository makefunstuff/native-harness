# Event-state reconciliation

Write two modules in the repository root:

- `protocol.ts` — event validation.
  - `export class EventError extends Error`.
  - `export function validateEvent(event)` throws `EventError` when: `key` is missing or not a
    string; `revision` is missing, not an integer, or negative; `operation` is not `"put"` or
    `"delete"`; a `put` has no `value` property. It returns the event.
- `reconcile.ts` — the reducer.
  - `export function reduceEvents(events, state = {})` returns a new state object.
  - An event is `{ key, revision, operation, value? }`; the state maps key to value. Events may
    name keys the state does not have yet.
  - For one key, the event with the **greatest revision wins**; equal revisions are broken by
    **position** (the later event in the list wins). `put` sets `state[key] = event.value`;
    `delete` removes the key.
  - Never mutate `events`, any event, or the input state; the returned state must not share
    nested objects with the inputs (changing a value in the result must not change an input).
  - No events returns an equal but fresh copy of the state.
  - Validate every event first with `validateEvent`; any invalid event throws `EventError`
    and nothing is changed.

Standard library only, deterministic, no global state. Add tests under `tests/` and run them
with `node --test tests/`.
