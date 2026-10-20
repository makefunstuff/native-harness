// ci-triage: 40 CI job logs, a machine-readable run history, a flaky-test history. The answer is a
// tally over all of it; the outcome test parses notes.md.
import { jsonl, lines, outcomeTest, pad, range, type Task, type Writer } from "./util.ts";

const JOBS = [
	"build",
	"test-unit",
	"test-integration",
	"lint",
	"typecheck",
	"bundle",
	"docker",
	"deploy-staging",
	"deploy-prod",
	"e2e",
	"smoke",
	"load",
	"audit-deps",
	"secrets-scan",
	"perf",
	"e2e-mobile",
	"migrate-db",
	"seed-db",
	"docs",
	"pages",
	"publish-npm",
	"release-notes",
	"analyze",
	"codespell",
	"shellcheck",
	"hadolint",
	"protogen",
	"openapi",
	"contracts",
	"visual",
	"accessibility",
	"i18n",
	"size",
	"budget",
	"sbom",
	"sign",
	"scan",
	"notify",
	"canary",
	"rollback",
];
const CATS = ["real", "infra", "flaky", "config", "dep"];
const CAT_P = [0.3, 0.3, 0.15, 0.15, 0.1];
const MSGS: Record<string, [string, string][]> = {
	real: [
		["tests/cart.test.ts", "AssertionError: expected 42 to equal 40"],
		["src/api/handlers.ts", "TypeError: Cannot read properties of undefined (reading 'id')"],
		["tests/api.test.ts", "assertion failed: status 500 != 200"],
		["src/store.ts", "index out of range"],
		["tests/e2e/checkout.ts", "expected true to be false"],
	],
	infra: [
		["runner", "network failure: connection reset by peer"],
		["runner", "timeout after 900s"],
		["runner", "out of memory: killed process"],
		["runner", "worker exited unexpectedly"],
	],
	flaky: [
		["tests/e2e/checkout.test.ts", "expected true to be false"],
		["tests/search.test.ts", "timeout: element not found"],
	],
	config: [
		[".ci/params.json", "missing required param region"],
		[".ci/params.json", "unknown region: valhalla"],
		[".ci/params.json", "missing required param tier"],
	],
	dep: [
		["node_modules/fast-parse", "cannot find module fast-parse"],
		["node_modules/date-fns", "no such package date-fns@4"],
		["node_modules/fast-parse", "missing dependency lodash"],
	],
};
const STEPS = ["checkout", "install", "build", "test", "publish"];
const FLAKY = [
	["tests/e2e/checkout.test.ts", "test_checkout_total"],
	["tests/search.test.ts", "test_ranking"],
	["tests/cart.test.ts", "test_promo_stack"],
	["tests/api.test.ts", "test_upload"],
	["tests/e2e/login.test.ts", "test_login_sso"],
];
const RETRY = [2, 1, 0, 2, 1, 0, 3, 2, 1, 0, 0, 0];

function category(r: number): string {
	let acc = 0;
	const p = r % 40;
	for (let i = 0; i < CATS.length; i++) {
		acc += CAT_P[i] * 40;
		if (p < acc) return CATS[i];
	}
	return "dep";
}

export const ciTriage: Task = {
	name: "ci-triage",
	questions: [
		"How many failures of each category (real, infra, flaky, config, dep) over the 40 runs?",
		"The most flaky test, with its count of failures in the history.",
		"The slowest run: its job and its duration in seconds.",
		"How many of the infra failures were retried (field `retry` > 0), and their total retry count?",
	],
	build(w: Writer) {
		const runs: any[] = [];
		const flaky: Record<string, number> = {};
		const notes: string[] = ["# Triage of the last 40 runs", ""];
		for (let r = 1; r <= 40; r++) {
			const job = JOBS[r - 1];
			let cat = category(r);
			if (cat === "real" && r % 4 === 0) cat = "flaky";
			const [file, msg] = MSGS[cat][r % MSGS[cat].length];
			const dur = 100 + 37 * r;
			const t0 = 1735689600 + r * 86400;
			w(
				`repo/ci/${job}.log`,
				lines([
					`run ${pad(r)} job=${job} step=${STEPS[r % STEPS.length]} rc=1 duration=${dur}s`,
					range(5 + (r % 20), (i) => `  ${pad(i)} step progress`),
					"",
					`--- failure ${file}`,
					"stack:",
					range(3, (i) => `  at f${i} (src/mod${i}.ts:${10 * i})`),
					msg,
					"",
					range(5 + (r % 30), (i) => `log ${pad(i)}: worker heartbeat`),
					`retry=${RETRY[r % RETRY.length]}`,
					`started=${t0} finished=${t0 + dur}`,
				]),
			);
			if (cat === "flaky") {
				const [f, t] = FLAKY[r % FLAKY.length];
				flaky[`${f}:${t}`] = (flaky[`${f}:${t}`] ?? 0) + 1;
			}
			notes.push(`- run ${pad(r)}: ${job} — ${cat} — ${file} — ${msg}`, `- \`${file}\``);
			runs.push({ run: r, job, cat, rc: 1, dur, step: STEPS[r % STEPS.length], f: file, retry: RETRY[r % RETRY.length], start: t0, end: t0 + dur });
		}
		w("repo/ci/triage_runs.jsonl", jsonl(runs));
		w(
			"repo/ci/flaky_history.csv",
			lines(["run,job,file,test,n_in_last_50", ...FLAKY.map(([f, t], i) => `${1000 + i * 3},${JOBS[i]},${f},${t},${(i % 4) + 1}`)]),
		);
		w("repo/ci/notes.md", lines(notes)); // the earlier triage the agent overwrites

		const cats: Record<string, number> = {};
		for (const cat of CATS) cats[cat] = runs.filter((r) => r.cat === cat).length;
		const topFlaky = Object.entries(flaky).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
		const slowest = runs.reduce((a, b) => (b.dur > a.dur ? b : a));
		const infra = runs.filter((r) => r.cat === "infra");
		const expected = {
			cats,
			top_flaky: topFlaky,
			slowest: [slowest.job, slowest.dur],
			infra_retried: [infra.filter((r) => r.retry > 0).length, infra.reduce((a, r) => a + r.retry, 0)],
		};

		w(
			"issue.md",
			lines([
				"The CI has been failing for 40 runs. For each run read its log under `ci/` (one file per",
				"job), the machine-readable history in `ci/triage_runs.jsonl`, and the flaky-test history in",
				"`ci/flaky_history.csv`.",
				"",
				"Answer, in `notes.md`:",
				...this.questions.map((q, i) => `${i + 1}. ${q}`),
				"",
				"Cite the evidence for every number.",
			]),
		);

		w(
			"hidden.test.ts",
			outcomeTest(
				expected,
				`
test("the category counts", () => {
	for (const [cat, want] of Object.entries(EXPECTED.cats) as [string, number][]) {
		assert.ok(says(\`\${cat}: \${want}\`) || says(\`\${cat}=\${want}\`), \`no count for \${cat} (\${want})\`);
		assert.ok(numbers(/\\b\\d+\\b/g).includes(want), \`\${cat}: nothing equal to \${want}\`);
	}
});

test("the most flaky test, with its count", () => {
	assert.ok(says(EXPECTED.top_flaky[0]), EXPECTED.top_flaky[0]);
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.top_flaky[1]), \`count \${EXPECTED.top_flaky[1]}\`);
});

test("the slowest run", () => {
	assert.ok(says(EXPECTED.slowest[0]), EXPECTED.slowest[0]);
	assert.ok(numbers(/\\b[\\d,]+\\b/g).map(Number).includes(EXPECTED.slowest[1]), \`duration \${EXPECTED.slowest[1]}\`);
});

test("the infra retries", () => {
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.infra_retried[0]), \`retried \${EXPECTED.infra_retried[0]}\`);
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.infra_retried[1]), \`total retries \${EXPECTED.infra_retried[1]}\`);
});
`,
			),
		);

		return {
			expected,
			ref: {
				"notes.md": lines([
					"# Triage of the last 40 runs",
					"",
					...Object.entries(cats).map(([c, n]) => `${c}: ${n}`),
					"ci/build.log:1",
					"",
					`Most flaky: ${topFlaky[0]} — ${topFlaky[1]} failures`,
					"ci/flaky_history.csv:1",
					"",
					`Slowest run: ${slowest.job} — ${slowest.dur} seconds`,
					`ci/triage_runs.jsonl:${slowest.run}`,
					"",
					`Infra failures retried: ${expected.infra_retried[0]}; total retries ${expected.infra_retried[1]}`,
					"ci/triage_runs.jsonl:2",
					...JOBS.slice(0, 6).map((j, i) => `ci/${j}.log:${i + 1}`),
				]),
			},
		};
	},
};
