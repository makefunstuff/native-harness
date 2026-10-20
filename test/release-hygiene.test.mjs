// The public-repo rules (scripts/no-secrets.mjs) and the release notes they gate
// (scripts/release-notes.mjs). Both run over a public repository, so what they must catch is tested
// here: a key, a personal path, a routable address, a tailnet name, and a version mismatch.
//
// Credential fixtures are built at run time, never written out in full: GitHub's push protection
// reads the source text, and the rule under test reads the value. A line whose fixture has to stay in
// the text (an address, a path shape) carries the rule's own allow marker and says why.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkText, lineFindings } from "../scripts/no-secrets.mjs";
import { notesFor, sectionFor } from "../scripts/release-notes.mjs";

const rules = (text) => checkText(text, "t").map((f) => f.split(": ")[1]);

/** Synthetic credentials, assembled at run time so no source line spells one out. */
export const FIXTURES = {
	openai: "api key sk" + "-" + "abcdefghij" + "0123456789",
	github: "token: " + JSON.stringify("ghp" + "_" + "a".repeat(36)),
	bearer: "Authorization: Bearer " + "b".repeat(20) + "0123456789",
	privkey: "-----BEGIN " + "RSA PRIVATE KEY" + "-----",
	aws: "AKIA" + "IOSFODNN7EXAMPLE",
	gemini: "AIza" + "SyA" + "1".repeat(32),
	slack: "xox" + "b" + "-" + "1".repeat(12) + "-" + "z".repeat(16),
	jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" + "." + "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
};

test("secrets and keys are found", () => {
	for (const [name, t] of Object.entries(FIXTURES)) assert.ok(rules(t).length, `not found: ${name} — ${t.length} chars`);
});

test("personal paths are found, CI and placeholder paths are not", () => {
	assert.ok(rules("the run wrote /home/some" + "user/.cache/x/out.json").length);
	assert.ok(rules("cd /Users/some" + "user/work/repo").length);
	assert.ok(rules("cat /root/.config/app/key").length); // no-secrets: allow (a fixture for the rule itself: the test must contain what the rule catches)
	for (const t of ["/home/runner/work/repo/repo/test.py", "/home/user/x", "/home/example/x", "~/.pi/agent/settings.json", "$HOME/.cache"])
		assert.deepEqual(rules(t), [], `flagged: ${t}`);
});

test("addresses: private, loopback, CGNAT and documentation ranges pass; routable ones do not", () => {
	for (
		const t of [
			"http://127.0.0.1:18190/v1", "http://10.0.0.2:8080/props", "http://192.168.1.5:8080/v1",
			"http://172.20.0.1/v1", "http://100.100.1.1/v1", "src_ip: \"192.0.2.40\"", "dst_ip: \"198.51.100.53\"",
			"203.0.113.7", "fe80::1", "fd12::1", "2001:db8::1", "::1", "8.8.8.8", "1.1.1.1", "169.254.1.1",
			"10/8, 172.16/12, 192.168/16, 100.64/10",
		]
	)
		assert.deepEqual(rules(t), [], `flagged: ${t}`);
	for (const t of ["server https://203.0.11" + "4.5/v1", "host 172.32.0" + ".1", "resolver 8.8.4" + ".4", "2001:41d0" + "::3"])
		assert.ok(rules(t).some((r) => r.startsWith("routable")), `not found: ${t}`);
});

test("tailnet hostnames are found, a product name is not", () => {
	assert.ok(rules("point it at box.tail1a2" + "b3c." + "ts.net").length);
	assert.deepEqual(rules("private networks: CGNAT/Tailscale ranges"), []);
});

test("a MAC address, a time and a colon list are not IPv6", () => {
	for (const t of ['src_mac": "a4:bb:6d:10:e2:f1', "10:00:00", "a:b:c", "aa:bb:cc:dd:ee:ff"]) assert.deepEqual(rules(t), [], `flagged: ${t}`);
});

test("an allow marker on the line skips it", () => {
	assert.deepEqual(lineFindings('const fixture = "172.32.0.1"; // no-secrets: allow (synthetic public fixture)'), []);
	assert.ok(lineFindings("const real = " + JSON.stringify("172.32.0" + ".1") + ";").length);
});

test("binary text is skipped", () => {
	assert.deepEqual(checkText(FIXTURES.openai + "\0binary", "t"), []);
});

const CHANGELOG = `# Changelog

Intro text.

## 0.1.0 — 2026-10-20

First release.

- **verify-gate** (stable) — runs the project's check.
- **npm** is not used.

## 0.0.9

Older.
`;
const PKG = { version: "0.1.0", repository: { url: "git+https://github.com/makefunstuff/pi-extras.git" } };

test("the notes are the version's changelog section, with the install line", () => {
	assert.equal(sectionFor(CHANGELOG, "0.1.0"), "First release.\n\n- **verify-gate** (stable) — runs the project's check.\n- **npm** is not used.");
	assert.equal(sectionFor(CHANGELOG, "0.0.9"), "Older.");
	assert.equal(sectionFor(CHANGELOG, "0.2.0"), null);
	const notes = notesFor({ changelog: CHANGELOG, pkg: PKG, tag: "v0.1.0" });
	assert.ok(notes.startsWith("# v0.1.0"), notes);
	assert.ok(notes.includes("First release."));
	assert.ok(notes.includes("Install: `pi install git:github.com/makefunstuff/pi-extras@v0.1.0`"), notes);
	assert.ok(!notes.includes("## 0.0.9") && !notes.includes("Older."), notes);
	assert.deepEqual(checkText(notes, "notes"), []);
});

test("a version that does not match package.json, or a missing section, is an error", () => {
	assert.throws(() => notesFor({ changelog: CHANGELOG, pkg: { ...PKG, version: "0.2.0" }, tag: "v0.1.0" }), /package.json is 0.2.0/);
	assert.throws(() => notesFor({ changelog: CHANGELOG, pkg: { ...PKG, version: "0.9.9" }, tag: "v0.9.9" }), /no "## 0.9.9" section/);
});

test("notes carrying a secret, a personal path or a routable address are refused", () => {
	for (const bad of [FIXTURES.openai, "written to /home/some" + "user/x", "on http://203.0.11" + "4.5/v1", "at box.tail1a2" + "b3c." + "ts.net"])
		assert.ok(checkText(bad, "notes").length, `not refused: ${bad.slice(0, 12)}…`);
});
