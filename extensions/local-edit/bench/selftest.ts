// Checks for the local-edit bench (no model needed):
//   - gen-tasks.ts reproduces the committed tickets in bench/tasks/ byte for byte;
//   - for every ticket the original repo FAILS the hidden tests only on the requested behaviour
//     (its untouched-code checks pass), and the reference solution PASSES the hidden and the
//     visible tests;
//   - run.ts and report.ts load.
//
//   node extensions/local-edit/bench/selftest.ts
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "local-edit-selftest-"));
let failed = 0;
try {
	execFileSync(process.execPath, [join(HERE, "gen-tasks.ts"), join(TMP, "generated")], { stdio: "pipe" });
	const diff = spawnSync("diff", ["-r", join(HERE, "tasks"), join(TMP, "generated")], { encoding: "utf8" });
	if (diff.status !== 0) {
		console.log(`bench/tasks differs from gen-tasks.ts output:\n${diff.stdout.slice(0, 2000)}`);
		failed++;
	}
	const run = (cwd: string, args: string[]) => spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...args], { cwd, encoding: "utf8", timeout: 60_000 });
	const failedTests = (out: string) => [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
	for (const t of readdirSync(join(HERE, "tasks"))) {
		const dir = join(HERE, "tasks", t);
		const w = join(TMP, t);
		cpSync(join(dir, "repo"), w, { recursive: true });
		cpSync(join(dir, "hidden.test.ts"), join(w, "hidden.test.ts"));
		const broken = run(w, ["hidden.test.ts"]);
		const brokenFails = failedTests(broken.stdout);
		const guardBroken = brokenFails.some((n) => /untouched|tabs kept/.test(n));
		rmSync(w, { recursive: true });
		cpSync(join(dir, "ref"), w, { recursive: true });
		cpSync(join(dir, "hidden.test.ts"), join(w, "hidden.test.ts"));
		const refHidden = run(w, ["hidden.test.ts"]);
		const refVisible = run(w, readdirSync(join(w, "tests")).filter((f) => f.endsWith(".test.ts")).map((f) => join("tests", f)));
		const ok = broken.status !== 0 && !guardBroken && refHidden.status === 0 && refVisible.status === 0;
		console.log(`${t} broken-hidden=${broken.status === 0 ? "PASS" : "fail"} broken-untouched=${guardBroken ? "FAIL" : "ok"} ref-hidden=${refHidden.status === 0 ? "PASS" : "FAIL"} ref-visible=${refVisible.status === 0 ? "PASS" : "FAIL"}`);
		if (!ok) {
			failed++;
			console.log(failedTests(refHidden.stdout), failedTests(refVisible.stdout), brokenFails);
		}
	}
	for (const f of ["run.ts", "report.ts"]) await import(join(HERE, f));
	await import(join(HERE, "../match.ts"));
	await import(join(HERE, "../paths.ts"));
} finally {
	rmSync(TMP, { recursive: true, force: true });
}
if (failed) {
	console.log(`LOCAL-EDIT BENCH SELFTEST FAILED (${failed})`);
	process.exit(1);
}
console.log("LOCAL-EDIT BENCH SELFTEST OK");
