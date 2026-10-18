export class TTLCache<V = unknown> {
	private data = new Map<string, { value: V; expires: number }>();
	private inflight = new Map<string, Promise<V>>();
	private ttl: number;
	private clock: () => number;
	constructor(ttl: number, clock: () => number = () => performance.now() / 1000) {
		this.ttl = ttl;
		this.clock = clock;
	}

	getOrCompute(key: string, fn: () => Promise<V>): Promise<V> {
		const hit = this.data.get(key);
		if (hit && hit.expires > this.clock()) return Promise.resolve(hit.value);
		const running = this.inflight.get(key);
		if (running) return running;
		const p = (async () => {
			try {
				const value = await fn();
				this.data.set(key, { value, expires: this.clock() + this.ttl });
				return value;
			} finally {
				this.inflight.delete(key);
			}
		})();
		this.inflight.set(key, p);
		return p;
	}

	get size(): number {
		const now = this.clock();
		let n = 0;
		for (const e of this.data.values()) if (e.expires > now) n++;
		return n;
	}
}
