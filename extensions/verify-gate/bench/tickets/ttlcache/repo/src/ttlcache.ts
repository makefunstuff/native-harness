// A small in-memory cache with a time to live per entry.
export class TtlCache<V> {
	private entries = new Map<string, { value: V; storedAt: number }>();
	private ttlMs: number;

	constructor(ttlMs: number) {
		this.ttlMs = ttlMs;
	}

	async getOrCompute(key: string, fn: () => Promise<V>): Promise<V> {
		const hit = this.entries.get(key);
		if (hit && Date.now() - hit.storedAt < this.ttlMs) return hit.value;
		const value = await fn();
		this.entries.set(key, { value, storedAt: Date.now() });
		return value;
	}

	get size(): number {
		return this.entries.size;
	}
}
