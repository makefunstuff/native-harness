// Decides which recalled lessons apply to the task. With a classifier model (Jev, the decision
// model homelab-tools registers as jev-lan/jev) every candidate becomes one yes/no question in a
// single classify call. Without one, or when the call fails, a plain score threshold decides.
import type { Candidate } from "./store.ts";

export interface ClassifierLike {
	classify(model: any, context: { state: Record<string, unknown>; questions: Record<string, any> }, options?: any): Promise<any>;
}

export interface Judged {
	kept: Array<Candidate & { p?: number }>;
	judge: string; // "jev-lan/jev", or "threshold"
	fallback?: string; // why the classifier was not used, when one was configured
	usage?: any;
}

export function thresholdFor(source: Candidate["source"], cfg: { minHindsight: number; minText: number }): number {
	return source === "hindsight" ? cfg.minHindsight : cfg.minText;
}

export function byThreshold(cands: Candidate[], k: number, cfg: { minHindsight: number; minText: number }): Candidate[] {
	return cands.filter((c) => c.score >= thresholdFor(c.source, cfg)).slice(0, k);
}

export async function judge(
	task: string,
	cands: Candidate[],
	opts: {
		k: number;
		minP: number;
		registry?: ClassifierLike;
		model?: any; // a classifier model, already looked up
		modelName?: string;
		minHindsight: number;
		minText: number;
		signal?: AbortSignal;
	},
): Promise<Judged> {
	if (!cands.length) return { kept: [], judge: opts.model ? (opts.modelName ?? "classifier") : "threshold" };
	if (!opts.model || !opts.registry) return { kept: byThreshold(cands, opts.k, opts), judge: "threshold" };
	const questions: Record<string, any> = {};
	cands.forEach((c, i) => {
		questions[`l${i}`] = {
			type: "bool",
			instructions:
				`Lesson ${i}: "When ${c.note.cue}: ${c.note.lesson}". Does this lesson apply to the task, so that a developer ` +
				"doing the task would make the mistake it warns about without knowing it? Same repository; judge by what the task will touch.",
			criteria: {
				true: "the task touches the situation the lesson's cue describes",
				false: "the lesson is about a different part of the code or a different kind of work",
			},
		};
	});
	try {
		const res = await opts.registry.classify(
			opts.model,
			{ state: { task: task.slice(0, 4000), lessons: cands.map((c, i) => ({ n: i, cue: c.note.cue, lesson: c.note.lesson })) }, questions },
			{ signal: opts.signal },
		);
		if (res?.stopReason !== "stop") throw new Error(res?.errorMessage ?? res?.stopReason ?? "no answer");
		const scored = cands.map((c, i) => ({ ...c, p: Number(res.answers?.[`l${i}`]?.probability ?? 0) }));
		const kept = scored
			.filter((c) => c.p >= opts.minP)
			.sort((a, b) => b.p - a.p)
			.slice(0, opts.k);
		return { kept, judge: opts.modelName ?? "classifier", usage: res.usage };
	} catch (e) {
		return {
			kept: byThreshold(cands, opts.k, opts),
			judge: "threshold",
			fallback: `${opts.modelName ?? "classifier"} failed (${String((e as Error)?.message ?? e).slice(0, 160)}); using the score threshold`,
		};
	}
}
