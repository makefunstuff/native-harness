// prod-incidents: one incident log, per-service dashboards, deploy records, a changelog, on-call
// notes. The answer is a growth ratio between two periods plus the cause in the deploy records.
import { jsonl, lines, outcomeTest, pad, range, type Task, type Writer } from "./util.ts";

const SERVICES = ["api-gateway", "search", "billing", "auth", "ingest", "worker", "web"];
const SYMPTOMS = ["p99 latency", "error rate", "cpu", "memory", "queue depth", "timeout rate", "5xx rate", "disk io"];
const CLUSTER: Record<string, string> = {
	"api-gateway": "edge",
	search: "edge",
	web: "edge",
	billing: "money",
	auth: "money",
	ingest: "pipes",
	worker: "pipes",
};
const CAUSE: Record<string, string> = {
	edge: "the retry policy in api-gateway (deploy 7711) amplifies load on search",
	money: "a connection-pool size drop (deploy 7712) exhausts db-primary",
	pipes: "a malformed message shape from ingest v41 (deploy 7713) breaks the workers",
};
const DEPLOYS = [
	{ id: 7711, ts: "2025-06-16T05:00:00Z", service: "api-gateway", change: "retry policy: retries 2 -> 5, backoff 100ms -> 10ms" },
	{ id: 7712, ts: "2025-06-16T05:30:00Z", service: "billing", change: "db pool max 20 -> 2" },
	{ id: 7713, ts: "2025-06-16T06:00:00Z", service: "ingest", change: "v41: new message shape (nested envelope)" },
];

const day = (i: number) => `2025-06-${pad(i + 1, 2)}`;
const tsOf = (d: string, hour: number) => Date.parse(`${d}T${pad(hour, 2)}:00:00Z`) / 1000;

export const prodIncidents: Task = {
	name: "prod-incidents",
	questions: [
		"Which service's incidents grew most, in ratio, from the baseline week to the bad week?",
		"Which cluster of services grew most, and what is the root cause named in the deploy records?",
		"The deploy that caused it, by its number.",
		"The most frequent pair of services that degrade together.",
	],
	build(w: Writer) {
		const incidents: any[] = [];
		const logs: string[] = [];
		const rows: string[] = [];
		let k = 0;
		for (let d = 15; d <= 30; d++) {
			const n = 2 + (d % 3);
			for (let j = 0; j < n; j++, k++) {
				const svc = SERVICES[(k * 3) % SERVICES.length];
				const sym = SYMPTOMS[(k * 5) % SYMPTOMS.length];
				const hour = Math.min(23, 6 + ((k * 2) % 18));
				const dur = 120 + (k % 5) * 60;
				const ts = tsOf(day(d), hour);
				incidents.push({ id: k + 1, ts, service: svc, symptom: sym, dur });
				rows.push(`${day(d)}T${pad(hour, 2)}:00Z,${svc},${sym},p99=${300 + ((k * 61) % 900)}ms,dur=${dur}s`);
				logs.push(
					`${day(d)}T${pad(hour, 2)}:00Z [WARN] ${svc}: ${sym} above budget`,
					`${day(d)}T${pad(hour, 2)}:01Z [WARN] ${svc}: upstream ${SERVICES[(k * 4) % SERVICES.length]} timeout`,
					`${day(d)}T${pad(hour, 2)}:02Z [INFO] ${svc}: auto-scaling to ${2 + (k % 4)} replicas`,
				);
				if (k > 3 && k % 4 === 0) {
					const a = SERVICES[(k * 5) % SERVICES.length];
					const b = SERVICES[(k * 7) % SERVICES.length];
					if (a !== b) {
						incidents.push({ pair: [a, b], ts });
						logs.push(`${day(d)}T${pad(hour, 2)}:03Z [WARN] ${a}: upstream dependency on ${b} degraded`);
					}
				}
			}
		}
		w("repo/incidents/incidents.log", lines(logs));
		w("repo/incidents/metrics.csv", lines(["ts,service,symptom,p99,duration", ...rows]));
		for (const s of SERVICES)
			w(`repo/dashboards/${s}.md`, lines([`# Dashboard: ${s}`, "", range(40, (j) => `- panel ${j}: ${SYMPTOMS[j % SYMPTOMS.length]}, threshold ${200 + j}ms, annotation "deploy ${7700 + j}"`)]));
		w("repo/deploys/deploys.jsonl", jsonl(DEPLOYS));
		w("repo/deploys/changelog.md", lines(["# Changelog", "", ...DEPLOYS.flatMap((d) => [`## ${d.id} — ${d.service}`, "", d.change, ""])]));
		w("repo/oncall.md", lines(["# On-call notes", "", "The last week (June 24 to June 30) is the bad period; the week before it (June 15 to June 22) is the baseline.", "Services belong to clusters: see the incident log for who depends on who."]));

		const inPeriod = (from: number, to: number) => incidents.filter((i) => i.ts >= from && i.ts <= to);
		const base = inPeriod(tsOf(day(15), 0), tsOf(day(22), 23) + 3599);
		const bad = inPeriod(tsOf(day(23), 0), tsOf(day(30), 23) + 3599);
		const count = (list: any[], key: (x: any) => string, k: string) => list.filter((x) => key(x) === k).length;
		const growth = SERVICES.map((s) => [s, (count(bad, (i) => i.service, s) + 1) / (count(base, (i) => i.service, s) + 1)] as [string, number]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
		const clusters = [...new Set(Object.values(CLUSTER))];
		const clusterGrowth: Record<string, number> = {};
		for (const c of clusters) {
			const mem = SERVICES.filter((s) => CLUSTER[s] === c);
			const b = mem.reduce((a, s) => a + count(base, (i) => i.service, s), 0);
			const g = mem.reduce((a, s) => a + count(bad, (i) => i.service, s), 0);
			clusterGrowth[c] = (g + 1) / (b + 1);
		}
		const worst = Object.entries(clusterGrowth).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
		const pairs = incidents.filter((i) => i.pair);
		const pairCount = new Map<string, number>();
		for (const p of pairs) {
			const key = [...p.pair].sort().join("|");
			pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
		}
		const topPair = [...pairCount.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0].split("|");
		const deploy = DEPLOYS.find((d) => SERVICES.filter((s) => CLUSTER[s] === worst).includes(d.service))!;
		const expected = {
			growth: growth[0],
			cluster: worst,
			cause: CAUSE[worst],
			deploy: deploy.id,
			pair: topPair,
			pair_count: pairCount.get([...topPair].sort().join("|")),
		};

		w(
			"issue.md",
			lines([
				"The last week of June was a bad period; the week before it is the baseline. The signals are",
				"all in this repository: an incident log, per-service dashboards, deploy records, a changelog",
				"and the on-call notes.",
				"",
				"Answer, in `notes.md`:",
				...this.questions.map((q, i) => `${i + 1}. ${q}`),
				"",
				"Cite the evidence for every fact.",
			]),
		);
		w(
			"hidden.test.ts",
			outcomeTest(
				expected,
				`
test("the fastest growing service", () => {
	assert.ok(says(EXPECTED.growth[0]), EXPECTED.growth[0]);
	assert.ok((notes.match(/\\d+\\.\\d+x?/g) ?? []).length > 0, "no ratio in notes.md");
});

test("the cluster and its root cause", () => {
	assert.ok(says(EXPECTED.cluster), EXPECTED.cluster);
	assert.ok(says(EXPECTED.cause), EXPECTED.cause);
});

test("the deploy that caused it", () => {
	assert.ok(says(String(EXPECTED.deploy)), String(EXPECTED.deploy));
});

test("the pair of services that degrade together", () => {
	assert.ok(says(EXPECTED.pair[0]) && says(EXPECTED.pair[1]), EXPECTED.pair.join(" / "));
});
`,
			),
		);

		return {
			expected,
			ref: {
				"notes.md": lines([
					"# Prod incidents",
					"",
					`Fastest growing service: ${growth[0][0]} (${growth[0][1].toFixed(2)}x)`,
					"incidents/metrics.csv:2",
					"",
					`Cluster ${worst} grew most: ${CAUSE[worst]}`,
					"incidents/incidents.log:1",
					"",
					`Deploy ${deploy.id} caused it`,
					"deploys/deploys.jsonl:1",
					"",
					`Pair: ${topPair[0]} and ${topPair[1]} (${expected.pair_count} times)`,
					"incidents/incidents.log:2",
					...SERVICES.map((s, i) => `dashboards/${s}.md:${i + 1}`),
				]),
			},
		};
	},
};
