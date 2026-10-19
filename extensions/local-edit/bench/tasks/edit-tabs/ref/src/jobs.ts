// Scheduler for periodic jobs (tab-indented: house style).

export class Job {
	name: string;
	every: number;
	action: () => unknown;
	runs = 0;
	last: number | undefined = undefined;

	constructor(name: string, every: number, action: () => unknown) {
		this.name = name;
		this.every = every;
		this.action = action;
	}

	due(now: number): boolean {
		if (this.last === undefined) {
			return true;
		}
		return now - this.last >= this.every;
	}

	run(now: number): unknown {
		this.runs += 1;
		this.last = now;
		return this.action();
	}
}

export class Scheduler {
	jobs = new Map<string, Job>();
	log: Array<[number, string, string]> = [];
	failures = new Map<string, number>();

	add(job: Job): void {
		if (this.jobs.has(job.name)) {
			throw new Error("duplicate job " + job.name);
		}
		this.jobs.set(job.name, job);
	}

	remove(name: string): void {
		if (!this.jobs.has(name)) {
			throw new Error("no job " + name);
		}
		this.jobs.delete(name);
	}

	tick(now: number): Record<string, unknown> {
		const results: Record<string, unknown> = {};
		for (const name of [...this.jobs.keys()].sort()) {
			const job = this.jobs.get(name)!;
			if ((this.failures.get(name) ?? 0) >= 3) {
				continue;
			}
			if (job.due(now)) {
				try {
					results[name] = job.run(now);
					this.failures.set(name, 0);
				} catch (e) {
					this.log.push([now, name, String(e)]);
					this.failures.set(name, (this.failures.get(name) ?? 0) + 1);
					results[name] = null;
				}
			}
		}
		return results;
	}

	nextDue(now: number): [number, string] | undefined {
		let best: [number, string] | undefined;
		for (const job of this.jobs.values()) {
			const at = job.last === undefined ? now : job.last + job.every;
			if (!best || at < best[0] || (at === best[0] && job.name < best[1])) {
				best = [at, job.name];
			}
		}
		return best;
	}
}

export function report0(scheduler: Scheduler, now: number): string {
	// Summary 0: jobs whose period is a multiple of 2.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 2 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report1(scheduler: Scheduler, now: number): string {
	// Summary 1: jobs whose period is a multiple of 3.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 3 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report2(scheduler: Scheduler, now: number): string {
	// Summary 2: jobs whose period is a multiple of 4.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 4 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report3(scheduler: Scheduler, now: number): string {
	// Summary 3: jobs whose period is a multiple of 5.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 5 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report4(scheduler: Scheduler, now: number): string {
	// Summary 4: jobs whose period is a multiple of 6.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 6 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report5(scheduler: Scheduler, now: number): string {
	// Summary 5: jobs whose period is a multiple of 7.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 7 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report6(scheduler: Scheduler, now: number): string {
	// Summary 6: jobs whose period is a multiple of 8.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 8 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report7(scheduler: Scheduler, now: number): string {
	// Summary 7: jobs whose period is a multiple of 9.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 9 === 0 || job.due(now)) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report8(scheduler: Scheduler, now: number): string {
	// Summary 8: jobs whose period is a multiple of 10.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 10 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report9(scheduler: Scheduler, now: number): string {
	// Summary 9: jobs whose period is a multiple of 11.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 11 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report10(scheduler: Scheduler, now: number): string {
	// Summary 10: jobs whose period is a multiple of 12.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 12 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report11(scheduler: Scheduler, now: number): string {
	// Summary 11: jobs whose period is a multiple of 13.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 13 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report12(scheduler: Scheduler, now: number): string {
	// Summary 12: jobs whose period is a multiple of 14.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 14 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report13(scheduler: Scheduler, now: number): string {
	// Summary 13: jobs whose period is a multiple of 15.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 15 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report14(scheduler: Scheduler, now: number): string {
	// Summary 14: jobs whose period is a multiple of 16.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 16 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report15(scheduler: Scheduler, now: number): string {
	// Summary 15: jobs whose period is a multiple of 17.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 17 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report16(scheduler: Scheduler, now: number): string {
	// Summary 16: jobs whose period is a multiple of 18.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 18 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}

export function report17(scheduler: Scheduler, now: number): string {
	// Summary 17: jobs whose period is a multiple of 19.
	const lines: string[] = [];
	for (const name of [...scheduler.jobs.keys()].sort()) {
		const job = scheduler.jobs.get(name)!;
		if (job.every % 19 === 0) {
			const state = job.due(now) ? "due" : "waiting";
			lines.push(name + ": " + state + " (" + job.runs + " runs)");
		}
	}
	return lines.join("\n");
}
