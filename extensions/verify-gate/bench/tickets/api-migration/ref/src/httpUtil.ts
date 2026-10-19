// HTTP helper. Timeouts are in milliseconds; the legacy seconds forms are converted.
export const DEFAULT_TIMEOUT_MS = 30000;

export const transport = {
	doRequest(url: string, timeoutMs: number): string {
		throw new Error(`no network in this module (${url}, ${timeoutMs})`);
	},
};

export interface CallOptions {
	timeoutMs?: number | null;
	/** @deprecated seconds; use timeoutMs */
	timeout?: number | null;
}

export function call(url: string, timeout?: number | CallOptions | null): string {
	let ms: number = DEFAULT_TIMEOUT_MS;
	if (typeof timeout === "number") ms = timeout * 1000;
	else if (timeout) {
		const hasNew = timeout.timeoutMs !== undefined && timeout.timeoutMs !== null;
		const hasOld = timeout.timeout !== undefined && timeout.timeout !== null;
		if (hasNew && hasOld) throw new TypeError("give timeoutMs or the legacy timeout, not both");
		if (hasNew) ms = timeout.timeoutMs as number;
		else if (hasOld) ms = (timeout.timeout as number) * 1000;
	}
	return transport.doRequest(url, Math.round(ms));
}
