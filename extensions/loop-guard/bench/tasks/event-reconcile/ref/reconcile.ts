import { validateEvent } from "./protocol.ts";

export function reduceEvents(events: any[], state: Record<string, unknown> = {}) {
	for (const e of events) validateEvent(e);
	const win = new Map<string, any>();
	for (const e of events) {
		const cur = win.get(e.key);
		if (!cur || e.revision >= cur.revision) win.set(e.key, e);
	}
	const out: Record<string, unknown> = structuredClone(state);
	for (const [k, e] of win) {
		if (e.operation === "put") out[k] = structuredClone(e.value);
		else delete out[k];
	}
	return out;
}
