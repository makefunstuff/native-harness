import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { grade, loadTicket, loadTickets, ownTests, PREAMBLE, seed, selftest, selftestAll } from "./tickets.ts";
import { git } from "./util.ts";

const t = () => mkdtempSync(join(tmpdir(), "pi-bench-tickets-"));

const HIDDEN = `import assert from "node:assert/strict";
import { test } from "node:test";
import { double } from "./src/calc.ts";

test("double", () => {
	assert.equal(double(21), 42);
});
`;

const VISIBLE = `import assert from "node:assert/strict";
import { test } from "node:test";
import { half } from "../src/calc.ts";

test("half", () => {
	assert.equal(half(4), 2);
});
`;

/** A ticket whose repo is broken (no `double`) and whose reference fixes it. */
function makeTicket(root: string, name: string) {
	const dir = join(root, name);
	mkdirSync(join(dir, "repo", "src"), { recursive: true });
	mkdirSync(join(dir, "repo", "tests"), { recursive: true });
	mkdirSync(join(dir, "ref", "src"), { recursive: true });
	writeFileSync(join(dir, "repo", "package.json"), '{ "name": "x", "private": true, "type": "module" }\n');
	writeFileSync(join(dir, "repo", "src", "calc.ts"), "export function half(x: number) {\n\tif (x % 2) throw new Error(\"odd\");\n\treturn x / 2;\n}\n");
	writeFileSync(join(dir, "repo", "tests", "calc.test.ts"), VISIBLE);
	writeFileSync(join(dir, "ref", "src", "calc.ts"), "export function half(x: number) {\n\tif (x % 2) throw new Error(\"odd\");\n\treturn x / 2;\n}\n\nexport function double(x: number) {\n\treturn x * 2;\n}\n");
	writeFileSync(join(dir, "issue.md"), "Add `double(x)` to src/calc.ts.\n\n## Rules\n\nDo not touch the tests.\n");
	writeFileSync(join(dir, "hidden.test.ts"), HIDDEN);
	return dir;
}

test("a ticket is issue + repo + hidden test + reference, and the prompt carries the rules", () => {
	const root = t();
	makeTicket(root, "double-it");
	const ticket = loadTicket(root, "double-it");
	assert.equal(ticket.name, "double-it");
	assert.deepEqual(ticket.files, ["package.json", "src/calc.ts", "tests/calc.test.ts"]); // repo ∪ ref
	assert.match(ticket.prompt, /Add `double\(x\)`/);
	assert.match(ticket.prompt, new RegExp(PREAMBLE.split("\n")[0]));
	assert.match(ticket.prompt, /Do not touch the tests/);
	assert.deepEqual(loadTickets(root).map((x) => x.name), ["double-it"]);
	assert.throws(() => loadTicket(root, "no-issue"), /issue/);
});

test("grading: the repo alone fails the hidden tests, the reference passes both suites", () => {
	const root = t();
	makeTicket(root, "double-it");
	const ticket = loadTicket(root, "double-it");

	const broken = t();
	seed(ticket, broken);
	assert.equal(grade(ticket, broken).ok, false);
	assert.equal(ownTests(broken).ok, true); // the visible tests pass on the untouched repo

	const fixed = t();
	seed(ticket, fixed);
	writeFileSync(join(fixed, "src", "calc.ts"), readFileSync(join(ticket.ref, "src", "calc.ts"), "utf8"));
	assert.equal(grade(ticket, fixed).ok, true);
	assert.equal(ownTests(fixed).ok, true);
});

test("the self-test wants a ticket that discriminates", () => {
	const root = t();
	makeTicket(root, "good");
	const good = selftest(loadTicket(root, "good"));
	assert.deepEqual([good.broken_hidden, good.ref_hidden, good.ref_visible, good.broken_visible], ["fail", "PASS", "PASS", "PASS"]);

	// a ticket whose repo already passes the hidden tests grades an unfixed tree
	makeTicket(root, "already-fixed");
	writeFileSync(join(root, "already-fixed", "repo", "src", "calc.ts"), readFileSync(join(root, "already-fixed", "ref", "src", "calc.ts"), "utf8"));
	const easy = selftest(loadTicket(root, "already-fixed"));
	assert.deepEqual([easy.broken_hidden, easy.ref_hidden, easy.ref_visible], ["PASS", "PASS", "PASS"]);

	// a reference that does not pass the hidden tests means the ticket is unsolvable as written
	makeTicket(root, "bad-ref");
	writeFileSync(join(root, "bad-ref", "ref", "src", "calc.ts"), "export function half(x: number) {\n\treturn x;\n}\n");
	const brokenRef = selftest(loadTicket(root, "bad-ref"));
	assert.deepEqual([brokenRef.broken_hidden, brokenRef.ref_hidden, brokenRef.ref_visible], ["fail", "FAIL", "FAIL"]); // the half-baked ref breaks the visible tests too
	assert.ok(brokenRef.tail.length > 0);

	const bad = selftestAll(root, () => {});
	assert.deepEqual(bad.map((b) => b.name), ["already-fixed", "bad-ref"]);
});

test("a work tree is seeded from the repo and starts as one git commit", () => {
	const root = t();
	makeTicket(root, "double-it");
	const work = t();
	seed(loadTicket(root, "double-it"), work);
	assert.deepEqual(readdirSync(work).filter((n) => n !== ".git").sort(), ["package.json", "src", "tests"]);
	assert.equal(git(["rev-list", "--count", "HEAD"], work).trim(), "1"); // the starting tree is one commit
	assert.equal(git(["status", "--porcelain"], work).trim(), ""); // and it is clean
	rmSync(work, { recursive: true, force: true });
	seed(loadTicket(root, "double-it"), work); // seeding is idempotent
	assert.equal(readdirSync(work).includes("package.json"), true);
});
