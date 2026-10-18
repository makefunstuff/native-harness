// Old call sites: they pass seconds. Do not edit.
import { call } from "./httpUtil.ts";

export function fetchStatus(): string {
	return call("http://status.invalid/", 5);
}

export function fetchReport(): string {
	return call("http://report.invalid/", { timeout: 2.5 });
}

export function fetchDefault(): string {
	return call("http://default.invalid/");
}
