export class EventError extends Error {}

export interface Event {
	key: string;
	revision: number;
	operation: "put" | "delete";
	value?: unknown;
}

export function validateEvent(event: unknown): Event {
	if (typeof event !== "object" || event === null || Array.isArray(event)) throw new EventError("event must be an object");
	const e = event as Record<string, unknown>;
	if (typeof e.key !== "string") throw new EventError("key must be a string");
	if (typeof e.revision !== "number" || !Number.isInteger(e.revision) || e.revision < 0) throw new EventError("revision must be a non-negative integer");
	if (e.operation !== "put" && e.operation !== "delete") throw new EventError("operation must be put or delete");
	if (e.operation === "put" && !("value" in e)) throw new EventError("put needs a value");
	return e as unknown as Event;
}
