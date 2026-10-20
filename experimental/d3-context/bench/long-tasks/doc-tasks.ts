// The data tickets of the long set: the answer is a tally over many documents. Each computes its
// expected answers from the fixtures as it writes them, and the outcome test parses notes.md.
import { jsonl, lines, outcomeTest, pad, range, type Task, type Writer } from "./util.ts";

const COMPONENTS = ["api", "auth", "billing", "search", "ingest", "worker", "web", "cli", "docs", "infra"];
const RELEASES = Array.from({ length: 25 }, (_, i) => `v${1 + Math.floor(i / 6)}.${i % 6}`); // v1.0 … v4.4 (25 releases)
const FEATS = [
	"streaming uploads",
	"per-key rate limits",
	"query cursors",
	"webhook retries",
	"batch deletes",
	"currency rounding",
	"field masks",
	"etag caching",
	"soft deletes",
	"audit log export",
	"scoped tokens",
	"webhook signatures",
	"csv import",
	"dry-run mode",
	"pagination totals",
	"idempotency keys",
	"bulk patches",
	"read replicas",
	"column pruning",
	"query budgets",
	"trace sampling",
	"structured errors",
	"schema migrations",
	"edge caching",
	"request coalescing",
	"webhook filters",
	"field redaction",
	"retention policies",
	"usage reports",
	"access tokens v2",
	"legacy v1 shims",
];

function releaseNotes() {
	const notes: string[] = [];
	const featsByRelease: Record<string, string[]> = {};
	const fixesByRelease: Record<string, number[]> = {};
	const breaking: Record<string, string[]> = {};
	for (let r = 0; r < RELEASES.length; r++) {
		const rel = RELEASES[r];
		const feats = [FEATS[(r * 3) % FEATS.length], FEATS[(r * 7 + 1) % FEATS.length]].filter((f, i, a) => a.indexOf(f) === i);
		const fixes = Array.from({ length: 3 + (r % 4) }, (_, i) => 1000 + r * 10 + i);
		const brk = r % 4 === 0 ? [`\`${["items", "search", "billing", "auth"][(r / 4) % 4]}响应\` renamed fields: \`qty\` -> \`quantity\``] : [];
		featsByRelease[rel] = feats;
		fixesByRelease[rel] = fixes;
		breaking[rel] = brk;
		notes.push(`# ${rel} — ${2023 + Math.floor(r / 9)}-${pad(1 + (r % 12), 2)}`, "", ...feats.map((f) => `- Added: ${f}`), ...brk.map((b) => `- BREAKING: ${b}`), ...fixes.map((n) => `- Fixed #${n}`), range(20 + (r % 10), (i) => `- internal: chore ${i}`), "");
	}
	return { notes, featsByRelease, fixesByRelease, breaking };
}

function releaseTicket(suffix: "a" | "b", pick: (d: ReturnType<typeof releaseNotes>) => { questions: string[]; expected: object; checks: string; ref: string[] }): Task {
	return {
		name: `release-${suffix}`,
		questions: [],
		build(w: Writer) {
			const d = releaseNotes();
			w("repo/RELEASE-NOTES.md", lines(d.notes));
			for (let m = 0; m < 33; m++) {
				const y = 2023 + Math.floor(m / 12);
				const mo = pad(1 + (m % 12), 2);
				w(`repo/changelog/${y}-${mo}.md`, lines([`# ${y}-${mo}`, "", range(12 + (m % 8), (i) => `- ${y}-${mo}-${pad(i, 2)}: shipped ${FEATS[(m * 5 + i) % FEATS.length]} (release ${RELEASES[(m + i) % RELEASES.length]}, issue #${2000 + m * 4 + i})`)]));
			}
			const issues = Array.from({ length: 150 }, (_, i) => ({
				number: 1000 + i,
				title: `${["Fix", "Handle", "Avoid", "Repair", "Guard"][(i * 3) % 5]} ${FEATS[(i * 5) % FEATS.length]} in ${COMPONENTS[(i * 2) % COMPONENTS.length]}`,
				state: "closed",
				closed_in: RELEASES[(i * 7) % RELEASES.length],
				component: COMPONENTS[(i * 2) % COMPONENTS.length],
			}));
			w("repo/issues/closed.jsonl", jsonl(issues));
			w("repo/docs/release-policy.md", lines(["# Release policy", "", "Releases are numbered `major.minor`. A release ships the features listed in `RELEASE-NOTES.md` and closes the issues listed there.", "The changelogs under `changelog/` are per month and name the release each change shipped in.", range(25, (i) => `Policy note ${i}: a breaking change is only allowed in a major release, and is listed with the prefix BREAKING.`)]));
			const out = pick(d);
			w(
				"issue.md",
				lines(["The release history of this project is all in the repository: the release notes, 33 monthly changelogs, and the closed-issue records.", "", "Answer, in `notes.md`:", ...out.questions.map((q, i) => `${i + 1}. ${q}`), "", "Cite the evidence for every answer."]),
			);
			w("hidden.test.ts", outcomeTest(out.expected, out.checks));
			return { expected: out.expected, checks: out.checks, ref: { "notes.md": lines(["# Release history", "", ...out.ref]) } };
		},
	};
}

export const releaseA = releaseTicket("a", (d) => {
	const rel = "v2.2";
	const firstFeature = d.featsByRelease[rel][0];
	const fixes = d.fixesByRelease[rel];
	const brk = Object.entries(d.breaking).filter(([, v]) => v.length);
	const withBreaking = brk.map(([r]) => r);
	return {
		questions: [
			`In which release did \`${firstFeature}\` first ship?`,
			`List the issue numbers fixed in \`${rel}\`.`,
			"List every release that carries a BREAKING change.",
			"How many releases are in the notes in total?",
		],
		expected: { feature_release: rel, fixes, breaking: withBreaking, n_releases: RELEASES.length },
		checks: `
test("the release a feature first shipped in", () => {
	assert.ok(says(EXPECTED.feature_release), EXPECTED.feature_release);
});

test("the issues fixed in the release", () => {
	for (const n of EXPECTED.fixes) assert.ok(says(String(n)), \`#\${n}\`);
});

test("the releases with breaking changes", () => {
	for (const r of EXPECTED.breaking) assert.ok(says(r), r);
});

test("the number of releases", () => {
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.n_releases), String(EXPECTED.n_releases));
});
`,
		ref: [
			`\`${Object.entries(d.featsByRelease).find(([, f]) => f.includes(firstFeature))![0]}\` shipped it`,
			"RELEASE-NOTES.md:1",
			`${rel} fixed: ${fixes.join(", ")}`,
			`RELEASE-NOTES.md:${RELEASES.indexOf(rel) * 4 + 1}`,
			`Breaking changes: ${withBreaking.join(", ")}`,
			"RELEASE-NOTES.md:2",
			`Releases in the notes: ${RELEASES.length}`,
			"issues/closed.jsonl:1",
			...RELEASES.slice(0, 4).map((r, i) => `RELEASE-NOTES.md:${i * 4 + 1} (${r})`),
		],
	};
});

export const releaseB = releaseTicket("b", (d) => {
	const byComponent: Record<string, number> = {};
	for (const rel of RELEASES) for (const n of d.fixesByRelease[rel]) byComponent[COMPONENTS[(n * 2) % COMPONENTS.length]] = (byComponent[COMPONENTS[(n * 2) % COMPONENTS.length]] ?? 0) + 1;
	const busiest = Object.entries(byComponent).sort((a, b) => b[1] - a[1])[0];
	const lastBreaking = Object.entries(d.breaking).filter(([, v]) => v.length).slice(-1)[0][0];
	const issuesPerRelease = Object.fromEntries(RELEASES.map((r) => [r, d.fixesByRelease[r].length]));
	return {
		questions: [
			"Which component has the most fixes in the release notes, and how many?",
			"The last release with a BREAKING change.",
			"How many issues does the median release fix?",
			"The number of changelog months on disk.",
		],
		expected: { busiest, last_breaking: lastBreaking, median_fixes: Object.values(issuesPerRelease).sort((a, b) => a - b)[Math.floor(RELEASES.length / 2)], months: 33 },
		checks: `
test("the busiest component", () => {
	assert.ok(says(EXPECTED.busiest[0]), EXPECTED.busiest[0]);
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.busiest[1]), String(EXPECTED.busiest[1]));
});

test("the last breaking release", () => {
	assert.ok(says(EXPECTED.last_breaking), EXPECTED.last_breaking);
});

test("the median fixes per release", () => {
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.median_fixes), String(EXPECTED.median_fixes));
});

test("the number of changelog months", () => {
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.months), String(EXPECTED.months));
});
`,
		ref: [
			`Busiest: ${busiest[0]} (${busiest[1]} fixes)`,
			"issues/closed.jsonl:1",
			`Last breaking: ${lastBreaking}`,
			"RELEASE-NOTES.md:3",
			`Median fixes per release: ${Object.values(Object.fromEntries(RELEASES.map((r) => [r, d.fixesByRelease[r].length]))).sort((a, b) => a - b)[Math.floor(RELEASES.length / 2)]}`,
			"RELEASE-NOTES.md:4",
			"Changelog months: 33",
			"changelog/2023-01.md:1",
			...RELEASES.slice(0, 4).map((r, i) => `RELEASE-NOTES.md:${i * 4 + 1} (${r})`),
		],
	};
});

// ── issue-triage: 30 issues, 10 docs, one config ───────────────────────────────────────────────
export const issueTriage: Task = {
	name: "issue-triage",
	questions: [
		"Which two open issues are duplicates of each other (same symptom, same component)?",
		"How many open issues are labelled `bug`, and how many `docs`?",
		"Which component has the most open issues, and how many?",
		"The oldest open issue with priority `p0`: its number and its title.",
	],
	build(w: Writer) {
		const issues: any[] = [];
		for (let i = 1; i <= 30; i++) {
			const component = COMPONENTS[(i * 3) % COMPONENTS.length];
			const state = i % 3 === 0 ? "closed" : "open";
			const labels = i % 5 === 0 ? ["bug", "p0"] : i % 4 === 0 ? ["docs"] : i % 2 === 0 ? ["bug"] : ["feature"];
			const opened = `2025-${pad(1 + (i % 12), 2)}-${pad(1 + (i % 27), 2)}`;
			const sym = i === 7 || i === 19 ? "stack overflow on nested query" : `${["crash", "timeout", "wrong total", "500", "empty page", "slow query"][(i * 5) % 6]} in ${component}`;
			issues.push({ number: i, component, state, labels, opened, sym });
			w(
				`repo/issues/${pad(i)}.md`,
				lines([
					`# Issue #${i}: ${sym}`,
					"",
					`Component: ${component}`,
					`State: ${state}`,
					`Labels: ${labels.join(", ")}`,
					`Opened: ${opened}`,
					"",
					range(15 + (i % 12), (j) => `- comment ${j}: ${["reproduced", "no repro yet", "bisected", "needs info", "seen in production"][(i + j) % 5]}`),
					"",
					"Stack:",
					range(4, (j) => `  at f${j} (src/${component}/mod${j}.ts:${10 * j})`),
				]),
			);
		}
		for (let d = 1; d <= 10; d++)
			w(`repo/docs/${COMPONENTS[d - 1]}.md`, lines([`# ${COMPONENTS[d - 1]} docs`, "", range(30, (i) => `- note ${i}: the ${COMPONENTS[d - 1]} module owns ${FEATS[(d * 3 + i) % FEATS.length]}`)]));
		w("repo/config.json", JSON.stringify({ triage: { p0: ["bug", "p0"], stale_after_days: 90 }, components: COMPONENTS }, null, 1) + "\n");

		const open = issues.filter((i) => i.state === "open");
		const byLabel = { bug: open.filter((i) => i.labels.includes("bug")).length, docs: open.filter((i) => i.labels.includes("docs")).length };
		const byComponent: Record<string, number> = {};
		for (const i of open) byComponent[i.component] = (byComponent[i.component] ?? 0) + 1;
		const busiest = Object.entries(byComponent).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
		const dupes = [7, 19];
		const p0 = open.filter((i) => i.labels.includes("p0")).sort((a, b) => (a.opened < b.opened ? -1 : 1))[0];
		const expected = { dupes, by_label: byLabel, busiest, p0: [p0.number, p0.sym] };

		w("issue.md", lines(["Triage the open issues in `issues/` (one file per issue, with its comments), the component docs, and `config.json`.", "", "Answer, in `notes.md`:", ...this.questions.map((q, i) => `${i + 1}. ${q}`), "", "Cite the issue file for every fact."]));
		w(
			"hidden.test.ts",
			outcomeTest(
				expected,
				`
test("the duplicate pair", () => {
	for (const n of EXPECTED.dupes) assert.ok(says(\`#\${n}\`) || numbers(/\\b\\d+\\b/g).includes(n), \`issue #\${n}\`);
});

test("the label counts", () => {
	assert.ok(says(\`bug: \${EXPECTED.by_label.bug}\`) || numbers(/\\b\\d+\\b/g).includes(EXPECTED.by_label.bug), \`bug \${EXPECTED.by_label.bug}\`);
	assert.ok(says(\`docs: \${EXPECTED.by_label.docs}\`) || numbers(/\\b\\d+\\b/g).includes(EXPECTED.by_label.docs), \`docs \${EXPECTED.by_label.docs}\`);
});

test("the component with the most open issues", () => {
	assert.ok(says(EXPECTED.busiest[0]), EXPECTED.busiest[0]);
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.busiest[1]), String(EXPECTED.busiest[1]));
});

test("the oldest p0", () => {
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.p0[0]), \`#\${EXPECTED.p0[0]}\`);
});
`,
			),
		);
		return {
			expected,
			ref: {
				"notes.md": lines([
					"# Triage",
					"",
					`Duplicates: #${dupes[0]} and #${dupes[1]} — ${issues[6].sym}`,
					"issues/007.md:3",
					"",
					`bug: ${byLabel.bug}`,
					`docs: ${byLabel.docs}`,
					"config.json:2",
					"",
					`Most open issues: ${busiest[0]} (${busiest[1]})`,
					"issues/001.md:3",
					"",
					`Oldest p0: #${p0.number} — ${p0.sym}`,
					`issues/${pad(p0.number)}.md:1`,
					...COMPONENTS.slice(0, 5).map((c, i) => `docs/${c}.md:${i + 1}`),
				]),
			},
		};
	},
};

// ── legacy-report: module docs, an API change log, two quarterly reports ────────────────────────
export const legacyReport: Task = {
	name: "legacy-report",
	questions: [
		"How many breaking changes does `api_changes.md` record in total?",
		"Which module has the most breaking changes, and how many?",
		"Which modules have no tests, according to their docs?",
		"How many deprecations were added in the period of the two quarterly reports?",
	],
	build(w: Writer) {
		const mods = COMPONENTS.slice(0, 12);
		const breaking: Record<string, number> = {};
		const untested: string[] = [];
		for (let m = 0; m < mods.length; m++) {
			const mod = mods[m];
			breaking[mod] = (m * 5) % 7;
			if (m % 4 === 1) untested.push(mod);
			w(
				`repo/modules/${mod}.md`,
				lines([
					`# ${mod}`,
					"",
					`Tests: ${m % 4 === 1 ? "none (the fixtures were dropped in 2023)" : "yes"}`,
					`Owner: team-${(m % 3) + 1}`,
					"",
					range(40 + m * 3, (i) => `- note ${i}: \`${mod}_${(i * 3) % 9}\` ${["reads", "writes", "forwards", "caches"][(i * 7) % 4]} ${FEATS[(m * 5 + i) % FEATS.length]}`),
				]),
			);
		}
		const changes: any[] = [];
		for (let i = 0; i < 90; i++) {
			const mod = mods[(i * 4) % mods.length];
			const kind = i % 5 === 0 ? "breaking" : i % 3 === 0 ? "deprecation" : "addition";
			changes.push({ date: `2025-${pad(1 + (i % 12), 2)}-${pad(1 + (i % 27), 2)}`, module: mod, kind, what: `${FEATS[(i * 6) % FEATS.length]} in ${mod}` });
		}
		w("repo/api_changes.md", lines(["# API changes", "", ...changes.map((c) => `- ${c.date} ${c.kind} ${c.module}: ${c.what}`)]));
		for (const [i, q] of [["2025-Q1", 0], ["2025-Q2", 1]] as [string, number][])
			w(`repo/reports/${q}.md`, lines([`# Quarterly report ${q}`, "", range(60 + i * 10, (j) => `- ${q} note ${j}: ${["shipped", "migrated", "removed", "deprecated"][(i + j) % 4]} ${FEATS[(j * 3) % FEATS.length]}`)]));

		const nBreaking = changes.filter((c) => c.kind === "breaking").length;
		const perModule: Record<string, number> = {};
		for (const c of changes.filter((c) => c.kind === "breaking")) perModule[c.module] = (perModule[c.module] ?? 0) + 1;
		const top = Object.entries(perModule).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
		const deprecations = changes.filter((c) => c.kind === "deprecation").length;
		const expected = { breaking_total: nBreaking, top_module: top, untested, deprecations };

		w("issue.md", lines(["Write the quarterly legacy report from the module docs (`modules/`), the API change log (`api_changes.md`) and the two quarterly reports (`reports/`).", "", "Answer, in `notes.md`:", ...this.questions.map((q, i) => `${i + 1}. ${q}`), "", "Cite the file for every number."]));
		w(
			"hidden.test.ts",
			outcomeTest(
				expected,
				`
test("the breaking change total", () => {
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.breaking_total), String(EXPECTED.breaking_total));
});

test("the module with the most breaking changes", () => {
	assert.ok(says(EXPECTED.top_module[0]), EXPECTED.top_module[0]);
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.top_module[1]), String(EXPECTED.top_module[1]));
});

test("the modules without tests", () => {
	for (const m of EXPECTED.untested) assert.ok(says(m), m);
});

test("the deprecations in the period", () => {
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.deprecations), String(EXPECTED.deprecations));
});
`,
			),
		);
		return {
			expected,
			ref: {
				"notes.md": lines([
					"# Legacy report",
					"",
					`Breaking changes recorded: ${nBreaking}`,
					"api_changes.md:3",
					"",
					`Most breaking: ${top[0]} (${top[1]})`,
					`modules/${top[0]}.md:1`,
					"",
					`No tests: ${untested.join(", ")}`,
					`modules/${untested[0]}.md:3`,
					"",
					`Deprecations in the period: ${deprecations}`,
					"reports/0.md:3",
					...mods.slice(0, 4).map((m, i) => `modules/${m}.md:${i + 1}`),
				]),
			},
		};
	},
};

// ── perf-hotspots: module profiles, a budget, flame notes, six deploys ─────────────────────────
export const perfHotspots: Task = {
	name: "perf-hotspots",
	questions: [
		"The worst hotspot (function and its p95 in ms) over all profiles.",
		"Which deploys made the p95 worse, by their numbers?",
		"How many functions are over the budget in `budget.json`, counting every profile?",
		"The total p95 of the top three hotspots, in ms.",
	],
	build(w: Writer) {
		const budget = { p95_ms: 50, n_samples: 200 };
		const rows: any[] = [];
		for (let m = 0; m < COMPONENTS.length; m++) {
			const mod = COMPONENTS[m];
			const fns = Array.from({ length: 14 }, (_, i) => ({ fn: `${mod}_f${i}`, p95: 10 + ((m * 17 + i * 13) % 90), samples: 20 + i }));
			rows.push(...fns.map((f) => ({ module: mod, ...f })));
			w(
				`repo/profiles/${mod}.md`,
				lines([`# Profile: ${mod}`, "", "| function | p95 ms | samples |", "|---|---|---|", ...fns.map((f) => `| ${f.fn} | ${f.p95} | ${f.samples} |`), "", range(20, (i) => `- note ${i}: allocation churn in ${mod}`)]),
			);
		}
		w("repo/budget.json", JSON.stringify(budget, null, 1) + "\n");
		w("repo/flame.md", lines(["# Flame notes", "", range(60, (i) => `- ${COMPONENTS[(i * 3) % COMPONENTS.length]}_f${i % 14} appears in ${30 + (i % 60)}% of the samples`)]));
		const deploys = Array.from({ length: 6 }, (_, i) => ({ id: 8000 + i, p95_before: 100 + i * 5, p95_after: 100 + i * 5 + [12, -4, 30, 0, -1, 9][i], change: `${["cache removal", "index added", "serialization change", "no-op", "pool resize", "retry added"][(i * 5) % 6]}` }));
		w("repo/deploys.jsonl", jsonl(deploys));
		const worst = rows.reduce((a, b) => (b.p95 > a.p95 ? b : a));
		const regressed = deploys.filter((d) => d.p95_after > d.p95_before).map((d) => d.id);
		const over = rows.filter((r) => r.p95 > budget.p95_ms).length;
		const top3 = [...rows].sort((a, b) => b.p95 - a.p95).slice(0, 3);
		const expected = { worst: [worst.fn, worst.p95], regressed, over, top3_sum: top3.reduce((a, r) => a + r.p95, 0) };

		w("issue.md", lines(["Read every profile in `profiles/`, the budget in `budget.json`, the flame notes and the deploy records.", "", "Answer, in `notes.md`:", ...this.questions.map((q, i) => `${i + 1}. ${q}`), "", "Cite the profile for every number."]));
		w(
			"hidden.test.ts",
			outcomeTest(
				expected,
				`
test("the worst hotspot", () => {
	assert.ok(says(EXPECTED.worst[0]), EXPECTED.worst[0]);
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.worst[1]), String(EXPECTED.worst[1]));
});

test("the deploys that regressed the p95", () => {
	for (const id of EXPECTED.regressed) assert.ok(numbers(/\\b\\d+\\b/g).includes(id), String(id));
});

test("the functions over budget", () => {
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.over), String(EXPECTED.over));
});

test("the total p95 of the top three", () => {
	assert.ok(numbers(/\\b\\d+\\b/g).includes(EXPECTED.top3_sum), String(EXPECTED.top3_sum));
});
`,
			),
		);
		return {
			expected,
			ref: {
				"notes.md": lines([
					"# Performance",
					"",
					`Worst hotspot: ${worst.fn} — ${worst.p95} ms p95`,
					`profiles/${worst.module}.md:4`,
					"",
					`Regressed deploys: ${regressed.join(", ")}`,
					"deploys.jsonl:1",
					"",
					`Over budget: ${over}`,
					"budget.json:2",
					"",
					`Top three total: ${expected.top3_sum} ms`,
					`profiles/${top3[0].module}.md:4`,
					...COMPONENTS.slice(0, 5).map((c, i) => `profiles/${c}.md:${i + 4}`),
				]),
			},
		};
	},
};
