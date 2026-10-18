// A small in-memory cache with a time to live per entry and one loader in flight per key.
export class TtlCache<V> {
	private entries = new Map<string, { value: V; storedAt: number }>();
	private inflight = new Map<string, Promise<V>>();
	private ttlMs: number;
	private now: () => number;

	constructor(ttlMs: number, opts: { now?: () => number } = {}) {
		this.ttlMs = ttlMs;
		this.now = opts.now ?? (() => performance.now());
	}

	async getOrCompute(key: string, fn: () => Promise<V>): Promise<V> {
		const hit = this.entries.get(key);
		if (hit && this.now() - hit.storedAt < this.ttlMs) return hit.value;
		const running = this.inflight.get(key);
		if (running) return running;
		const p = (async () => {
			try {
				const value = await fn();
				this.entries.set(key, { value, storedAt: this.now() });
				return value;
			} finally {
				this.inflight.delete(key);
			}
		})();
		this.inflight.set(key, p);
		return p;
	}

	get size(): number {
		const t = this.now();
		let n = 0;
		for (const e of this.entries.values()) if (t - e.storedAt < this.ttlMs) n++;
		return n;
	}
}
