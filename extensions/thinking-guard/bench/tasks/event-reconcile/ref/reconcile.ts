import { validateEvent } from "./protocol.ts";

export function reduceEvents(events: any[], state: Record<string, unknown> = {}) {
	events.forEach(validateEvent);
	const winner = new Map<string, any>();
	for (const e of events) {
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
