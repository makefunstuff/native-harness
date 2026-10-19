// HTTP helper. Timeouts are in seconds.
export const DEFAULT_TIMEOUT = 30;

export const transport = {
	doRequest(url: string, timeout: number): string {
		throw new Error(`no network in this module (${url}, ${timeout})`);
	},
};

export function call(url: string, timeout?: number | { timeout?: number }): string {
	const t = typeof timeout === "object" && timeout !== null ? timeout.timeout : timeout;
	return transport.doRequest(url, t || DEFAULT_TIMEOUT);
}
