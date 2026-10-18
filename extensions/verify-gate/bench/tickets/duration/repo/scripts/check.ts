// The project's check: the tests, then the changelog rule (a line under "## Unreleased").
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tests = spawnSync(process.execPath, ["--test"], { stdio: "inherit" });
if (tests.status !== 0) process.exit(tests.status ?? 1);
const log = readFileSync("CHANGELOG.md", "utf8");
const unreleased = log.split(/^## /m).find((s) => s.startsWith("Unreleased")) ?? "";
if (!/^\s*[-*] \S/m.test(unreleased)) {
	console.error("check: CHANGELOG.md has no entry under ## Unreleased (every user-visible change needs one)");
	process.exit(1);
}
console.log("check: ok");
