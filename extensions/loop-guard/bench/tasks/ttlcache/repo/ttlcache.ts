// A small TTL cache for async loaders.

export class TTLCache<V> {
	private entries = new Map<string, { value: V; storedAt: number }>();
	private ttlMs: number;
	private clock: () => number;

	constructor(ttlMs: number, clock: () => number = () => performance.now()) {
		this.ttlMs = ttlMs;
		this.clock = clock;
	}

	async getOrCompute(key: string, fn: () => Promise<V>): Promise<V> {
		const hit = this.entries.get(key);
		if (hit && this.clock() - hit.storedAt < this.ttlMs) return hit.value;
		const value = await fn();
		this.entries.set(key, { value, storedAt: this.clock() });
		return value;
	}

	get size(): number {
		return this.entries.size;
	}
}
