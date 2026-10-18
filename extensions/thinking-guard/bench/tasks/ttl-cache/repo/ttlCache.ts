export class TTLCache<V = unknown> {
	private data = new Map<string, { value: V; expires: number }>();
	private ttl: number;
	constructor(ttl: number) {
		this.ttl = ttl;
	}

	async getOrCompute(key: string, fn: () => Promise<V>): Promise<V> {
		const hit = this.data.get(key);
		if (hit && hit.expires > Date.now() / 1000) return hit.value;
		const value = await fn();
		this.data.set(key, { value, expires: Date.now() / 1000 + this.ttl });
		return value;
	}

	get size(): number {
		return this.data.size;
	}
}
