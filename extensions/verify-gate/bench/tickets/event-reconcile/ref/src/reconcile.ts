import { type Event, validateEvent } from "./protocol.ts";

export function reduceEvents(events: unknown[], state: Record<string, unknown> = {}): Record<string, unknown> {
	const valid = events.map(validateEvent);
	const winner = new Map<string, Event>();
	for (const e of valid) {
		const cur = winner.get(e.key);
		if (!cur || e.revision >= cur.revision) winner.set(e.key, e);
	}
	const out: Record<string, unknown> = structuredClone(state);
	for (const [key, e] of winner) {
		if (e.operation === "put") out[key] = structuredClone(e.value);
		else delete out[key];
	}
	return out;
}
