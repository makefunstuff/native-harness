export class EventError extends Error {}

export function validateEvent(event: any) {
	if (!event || typeof event !== "object") throw new EventError("event must be an object");
	if (typeof event.key !== "string") throw new EventError("key");
	if (!Number.isInteger(event.revision) || event.revision < 0) throw new EventError("revision");
	if (event.operation !== "put" && event.operation !== "delete") throw new EventError("operation");
	if (event.operation === "put" && !("value" in event)) throw new EventError("value");
	return event;
}
