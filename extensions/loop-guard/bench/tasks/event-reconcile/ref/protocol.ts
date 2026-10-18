export class EventError extends Error {}

export function validateEvent(event: any) {
	if (!event || typeof event !== "object" || !("key" in event)) throw new EventError("missing key");
	if (typeof event.revision !== "number" || !Number.isInteger(event.revision) || event.revision < 0) throw new EventError("bad revision");
	if (event.operation !== "put" && event.operation !== "delete") throw new EventError("bad operation");
	if (event.operation === "put" && !("value" in event)) throw new EventError("put without value");
	return event;
}
