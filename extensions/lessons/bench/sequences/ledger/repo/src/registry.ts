// The operations the billing service can call, by name. The service only sees what is listed here.
import { percentOf } from "./ops/percent.ts";
import { sumCents } from "./ops/sum.ts";

export const OPERATIONS: Record<string, (...args: any[]) => unknown> = {
	percentOf,
	sumCents,
};
