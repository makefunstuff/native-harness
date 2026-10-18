// Where lessons live.
//
//   FileStore       one JSON file per repository under <dir> (default <pi agent dir>/lessons/).
//                   Always written: it is the whole library on setups without Hindsight, and the
//                   fallback (plain-text matching) when Hindsight cannot be reached.
//   HindsightStore  the Hindsight memory bank behind homelab-tools' memory_retain / memory_recall
//                   (same server, bank and key settings). Each lesson is one document, tagged
//                   `pi-lessons` and `repo:<repo>`, with the note in its metadata; recall is
//                   Hindsight's semantic + keyword search, filtered to those tags.
//   Library         both together: caps, dedupe, expiry, and the fallback.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Note, clampConfidence, expired, keepScore, merge, rankByText, similarity } from "./note.ts";

export interface Candidate {
	note: Note;
	score: number; // store-specific: Hindsight's final score, or the plain-text cover
	source: "hindsight" | "file";
}

// ---- files ------------------------------------------------------------------------------------

export class FileStore {
	readonly dir: string;
	constructor(dir: string) {
		this.dir = dir;
	}

	private file(repo: string): string {
		return join(this.dir, `${repo.replace(/[^\w.-]+/g, "_").slice(0, 120)}.json`);
	}

	list(repo: string): Note[] {
		const f = this.file(repo);
		if (!existsSync(f)) return [];
		try {
			const data = JSON.parse(readFileSync(f, "utf8"));
			return Array.isArray(data?.notes) ? data.notes : [];
		} catch {
			return [];
		}
	}

	write(repo: string, notes: Note[]): void {
		mkdirSync(this.dir, { recursive: true });
		const f = this.file(repo);
		const tmp = `${f}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify({ repo, notes }, null, 1)}\n`);
		renameSync(tmp, f);
	}
}

// ---- Hindsight --------------------------------------------------------------------------------

export interface HindsightConfig {
	url: string;
	bank: string;
	key?: string;
	timeoutMs: number;
}

export const TAG = "pi-lessons";

export class HindsightStore {
	readonly cfg: HindsightConfig;
	constructor(cfg: HindsightConfig) {
		this.cfg = cfg;
	}

	private async call(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (this.cfg.key) headers.Authorization = `Bearer ${this.cfg.key}`;
		const t = AbortSignal.timeout(this.cfg.timeoutMs);
		const res = await fetch(`${this.cfg.url.replace(/\/+$/, "")}/v1/default/banks/${encodeURIComponent(this.cfg.bank)}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: signal ? AbortSignal.any([signal, t]) : t,
		});
		const text = await res.text();
		if (res.status === 404 && method === "DELETE") return {};
		if (!res.ok) throw new Error(`Hindsight answered ${res.status}: ${text.slice(0, 200)}`);
		return text ? JSON.parse(text) : {};
	}

	// One document per lesson; writing the same id again replaces it (dedupe on Hindsight's side).
	async save(n: Note, signal?: AbortSignal): Promise<void> {
		const content = `Lesson for the ${n.repo} repository (pi-lessons). When ${n.cue}: ${n.lesson}${n.evidence ? ` Evidence: ${n.evidence}` : ""}`;
		await this.call(
			"POST",
			"/memories",
			{
				async: false,
				items: [
					{
						content,
						context: "pi-lessons",
						timestamp: n.updated,
						document_id: n.id,
						update_mode: "replace",
						tags: [TAG, `repo:${n.repo}`],
						metadata: {
							kind: "pi-lesson",
							id: n.id,
							repo: n.repo,
							cue: n.cue,
							lesson: n.lesson,
							evidence: n.evidence,
							confidence: String(n.confidence),
							created: n.created,
							updated: n.updated,
							hits: String(n.hits),
						},
					},
				],
			},
			signal,
		);
	}

	async remove(id: string, signal?: AbortSignal): Promise<void> {
		await this.call("DELETE", `/documents/${encodeURIComponent(id)}`, undefined, signal);
	}

	async recall(repo: string, query: string, k: number, signal?: AbortSignal): Promise<Candidate[]> {
		const body = await this.call(
			"POST",
			"/memories/recall",
			{ query: query.slice(0, 2000), max_tokens: 2000, types: ["world", "experience"], tags: [TAG, `repo:${repo}`], tags_match: "all_strict" },
			signal,
		);
		const best = new Map<string, Candidate>();
		for (const r of (body.results ?? []) as any[]) {
			const m = r.metadata ?? {};
			if (m.kind !== "pi-lesson" || !m.id || m.repo !== repo) continue;
			const score = Number(r.scores?.final ?? 0);
			const prev = best.get(m.id);
			if (prev && prev.score >= score) continue;
			best.set(m.id, {
				source: "hindsight",
				score,
				note: {
					id: m.id,
					repo: m.repo,
					cue: m.cue ?? "",
					lesson: m.lesson ?? "",
					evidence: m.evidence ?? "",
					confidence: clampConfidence(m.confidence),
					created: m.created ?? m.updated ?? new Date(0).toISOString(),
					updated: m.updated ?? new Date(0).toISOString(),
					hits: Number(m.hits) || 1,
				},
			});
		}
		return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
	}
}

// ---- both -------------------------------------------------------------------------------------

export interface LibraryConfig {
	maxNotes: number; // per repository; the lowest keepScore goes first
	ttlDays: number; // notes not written or confirmed for this long are dropped (0 = never)
	dropBelow: number; // a contradicted note whose confidence falls below this is deleted
	dedupe: number; // similarity at which a new note merges into an existing one
}

export const DEFAULT_LIBRARY: LibraryConfig = { maxNotes: 40, ttlDays: 180, dropBelow: 0.3, dedupe: 0.6 };

export interface Recall {
	candidates: Candidate[];
	source: "hindsight" | "file";
	fallback?: string; // why Hindsight was not used, when it was configured
}

export class Library {
	readonly files: FileStore;
	readonly hindsight: HindsightStore | undefined;
	readonly cfg: LibraryConfig;
	constructor(files: FileStore, hindsight: HindsightStore | undefined, cfg: LibraryConfig = DEFAULT_LIBRARY) {
		this.files = files;
		this.hindsight = hindsight;
		this.cfg = cfg;
	}

	errors: string[] = []; // Hindsight write failures, reported to the user by the caller

	private live(repo: string, now = Date.now()): Note[] {
		const all = this.files.list(repo);
		const keep = all.filter((n) => !expired(n, this.cfg.ttlDays, now));
		if (keep.length !== all.length) this.files.write(repo, keep);
		return keep;
	}

	async recall(repo: string, query: string, k: number, signal?: AbortSignal): Promise<Recall> {
		const now = Date.now();
		let local = this.live(repo, now);
		const ranked = rankByText(query, local)
			.filter((r) => r.score > 0)
			.slice(0, k)
			.map((r) => ({ note: r.note, score: r.score, source: "file" as const }));
		let fallback: string | undefined;
		if (this.hindsight) {
			try {
				const hits = await this.hindsight.recall(repo, query, k, signal);
				// The local copy is newer for notes written or contradicted on this machine; notes
				// only Hindsight has (another machine) are taken as they are, unless expired. Local
				// notes Hindsight did not return (a write that failed, or a weaker semantic match)
				// still compete through plain-text matching.
				const byId = new Map(local.map((n) => [n.id, n]));
				const merged: Candidate[] = hits
					.map((c) => ({ ...c, note: byId.get(c.note.id) ?? c.note }))
					.filter((c) => !expired(c.note, this.cfg.ttlDays, now) && c.note.confidence >= this.cfg.dropBelow);
				const seen = new Set(merged.map((c) => c.note.id));
				merged.push(...ranked.filter((c) => !seen.has(c.note.id)));
				local = await this.sync(repo, local, signal);
				return { candidates: merged, source: "hindsight" };
			} catch (e) {
				fallback = `Hindsight recall failed (${String((e as Error)?.message ?? e).slice(0, 160)}); using plain-text matching on the local copy`;
			}
		}
		return { candidates: ranked, source: "file", fallback };
	}

	// Retry the Hindsight writes that failed earlier (a few per call; stops at the first failure).
	private async sync(repo: string, notes: Note[], signal?: AbortSignal): Promise<Note[]> {
		const todo = notes.filter((n) => n.synced === false).slice(0, 3);
		if (!todo.length || !this.hindsight) return notes;
		for (const n of todo) {
			try {
				await this.hindsight.save(n, signal);
				n.synced = true;
			} catch {
				break;
			}
		}
		this.files.write(repo, notes);
		return notes;
	}

	// Write a note to Hindsight; the local copy remembers whether that worked.
	private async push(note: Note, signal?: AbortSignal, evicted: string[] = []): Promise<void> {
		if (!this.hindsight) return;
		try {
			await this.hindsight.save(note, signal);
			for (const id of evicted) await this.hindsight.remove(id, signal);
			note.synced = true;
		} catch (e) {
			note.synced = false;
			this.errors.push(`Hindsight write failed (${String((e as Error)?.message ?? e).slice(0, 160)}); the lesson is kept in the local copy and sent again later`);
		}
	}

	// Save a new note: merged into an existing one that says the same thing, else added; the
	// library is then cut back to its cap. Returns the note as stored and what happened.
	async save(fresh: Note, signal?: AbortSignal): Promise<{ note: Note; action: "added" | "merged"; evicted: string[] }> {
		const notes = this.live(fresh.repo);
		let i = notes.findIndex((n) => n.id === fresh.id);
		if (i < 0) {
			let best = -1;
			let bestSim = 0;
			notes.forEach((n, j) => {
				const s = similarity(n, fresh);
				if (s > bestSim) [best, bestSim] = [j, s];
			});
			if (bestSim >= this.cfg.dedupe) i = best;
		}
		let note: Note;
		let action: "added" | "merged";
		if (i >= 0) {
			note = merge(notes[i], fresh);
			notes[i] = note;
			action = "merged";
		} else {
			note = fresh;
			notes.push(note);
			action = "added";
		}
		const evicted: string[] = [];
		if (notes.length > this.cfg.maxNotes) {
			const now = Date.now();
			notes.sort((a, b) => keepScore(b, now) - keepScore(a, now));
			for (const n of notes.splice(this.cfg.maxNotes)) if (n.id !== note.id) evicted.push(n.id);
		}
		await this.push(note, signal, evicted);
		this.files.write(fresh.repo, notes);
		return { note, action, evicted };
	}

	// A shown note proved wrong (delta < 0) or helped (delta > 0). Wrong notes lose confidence and
	// are deleted once below `dropBelow`: that is how a contradicted lesson expires.
	async adjust(repo: string, note: Note, delta: number, signal?: AbortSignal): Promise<"dropped" | "updated"> {
		const notes = this.live(repo);
		const i = notes.findIndex((n) => n.id === note.id);
		const cur = i >= 0 ? notes[i] : note;
		const next: Note = { ...cur, confidence: clampConfidence(cur.confidence + delta), hits: cur.hits + (delta > 0 ? 1 : 0) };
		if (delta > 0) next.updated = new Date().toISOString();
		const drop = next.confidence < this.cfg.dropBelow;
		if (drop) {
			if (i >= 0) notes.splice(i, 1);
			if (this.hindsight) {
				try {
					await this.hindsight.remove(note.id, signal);
				} catch (e) {
					this.errors.push(`Hindsight delete failed (${String((e as Error)?.message ?? e).slice(0, 160)})`);
				}
			}
		} else {
			if (i >= 0) notes[i] = next;
			else notes.push(next);
			await this.push(next, signal);
		}
		this.files.write(repo, notes);
		return drop ? "dropped" : "updated";
	}

	async forget(repo: string, id: string, signal?: AbortSignal): Promise<boolean> {
		const notes = this.live(repo);
		const keep = notes.filter((n) => n.id !== id);
		this.files.write(repo, keep);
		if (this.hindsight) {
			try {
				await this.hindsight.remove(id, signal);
			} catch (e) {
				this.errors.push(`Hindsight delete failed (${String((e as Error)?.message ?? e).slice(0, 160)})`);
			}
		}
		return keep.length !== notes.length;
	}
}
