// A small TTL cache for async loaders.

export class TTLCache<V> {
	private entries = new Map<string, { value: V; storedAt: number }>();
	private pending = new Map<string, Promise<V>>();
	private ttlMs: number;
	private clock: () => number;

	constructor(ttlMs: number, clock: () => number = () => performance.now()) {
		this.ttlMs = ttlMs;
		this.clock = clock;
	}

	async getOrCompute(key: string, fn: () => Promise<V>): Promise<V> {
		const hit = this.entries.get(key);
		if (hit && this.clock() - hit.storedAt < this.ttlMs) return hit.value;
		const running = this.pending.get(key);
		if (running) return running;
		const p = (async () => {
			try {
				const value = await fn();
				this.entries.set(key, { value, storedAt: this.clock() });
				return value;
			} finally {
				this.pending.delete(key);
			}
		})();
		this.pending.set(key, p);
		return p;
	}

	get size(): number {
		const now = this.clock();
		let n = 0;
		for (const e of this.entries.values()) if (now - e.storedAt < this.ttlMs) n++;
		return n;
	}
}
