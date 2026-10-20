#!/usr/bin/env node
// The repository's public-repo rule, in one place: no secrets, no keys, no personal paths, no
// routable addresses, no tailnet hostnames. This repository is public, and so are its recorded
// benchmark rows, its READMEs and its release notes.
//
// CI runs this as a step of its own, scripts/check.sh calls it at the start, and
// scripts/release-notes.mjs runs the same rules over a release's notes before they are posted.
//
//   node scripts/no-secrets.mjs            check the whole working tree (tracked, untracked, generated)
//   node scripts/no-secrets.mjs --staged    check what is staged (a pre-commit hook)
//   checkText(text, where)                  the rules, for reuse
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO } from "../test/lib/harness.mjs";

// name: [pattern, why]. A line matching a pattern is a finding.
export const RULES = [
	["secret", /(?:\b(?:sk|pk|rk|rh|sh|ss|xox[baprs])[-_][A-Za-z0-9_=-]{12,})|(?:\bgh[pousr]_[A-Za-z0-9]{16,})|(?:\bgithub_pat_[A-Za-z0-9_]{16,})|(?:\bAKIA[0-9A-Z]{16}\b)|(?:\bAIza[0-9A-Za-z_-]{35}\b)|(?:eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,})/],
	["private key", /BEGIN [A-Z ]*PRIVATE KEY/],
	["credential in an assignment", /\b(api[_-]?key|apikey|client_secret|secret|password|passwd|access_token|auth token)[^#\n]{0,6}[:=][^#\n]{0,6}["'`][A-Za-z0-9+/=_.:-]{20,}["'`]/i],
	["credential in a header", /(?:Authorization|X-Api-Key|x-api-key)\s*[:=]\s*(?:Bearer|Basic|Token)\s+[A-Za-z0-9+/=._-]{16,}/i],
	["personal home path", /(^|[\s"'`(:=,])\/home\/(?!runner\b|linuxbrew\b|user\b|example\b|ci\b|build\b|vagrant\b)[A-Za-z0-9._-]+\//], // no-secrets: allow (the rule's own pattern)
	["personal home path", /(^|[\s"'`(:=,])\/Users\/[A-Za-z0-9._-]+\//], // no-secrets: allow (the rule's own pattern)
	["root home path", /(^|[\s"'`(:=,])\/root\/[A-Za-z0-9._-]+\//], // no-secrets: allow (the rule's own pattern)
	["tailnet hostname", /\b[a-z0-9-]+\.ts\.net\b/], // no-secrets: allow (the rule's own pattern)
	["routable IPv4", ipv4Routable],
	["routable IPv6", ipv6Routable],
];

// Private, loopback, link-local, CGNAT/Tailscale ranges and the documentation ranges of
// RFC 5737 / RFC 3849 are fine: they are the addresses the code and the docs describe, and they
// route nowhere on the internet. 8.8.8.8 and 1.1.1.1 are the usual public fixtures.
const IPV4_OK = [
	/^0\./, /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
	/^169\.254\./, /^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./, /^22[4-9]\./, /^23\d\./, /^24\d\./, /^25[0-5]\./,
	/^8\.8\.8\.8$/, /^1\.1\.1\.1$/, /^192\.0\.0\.\d+$/, /^198\.18\./, /^198\.19\./,
];
function ipv4Routable(line) {
	const out = [];
	for (const m of line.matchAll(/(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g)) {
		const ip = m[0];
		if ([m[1], m[2], m[3], m[4]].some((n) => Number(n) > 255)) continue; // not an address
		if (!IPV4_OK.some((re) => re.test(ip))) out.push(`${ip} (a routable address: a public repo must not name one)`);
	}
	return out;
}
const IPV6_OK = [/^::1$/, /^::$/, /^fe80/i, /^fc/i, /^fd/i, /^2001:0?db8/i, /^ff/i];
function ipv6Routable(line) {
	const out = [];
	for (const m of line.matchAll(/(?<![\w:])((?:[\da-fA-F]{0,4}:){2,7}[\da-fA-F]{0,4})(?![\w:])/g)) {
		const ip = m[1];
		const groups = ip.split(":").filter(Boolean);
		if (groups.length < 2) continue;
		// Not an address when it has no "::" and every group is two hex digits: that is a MAC
		// address, a time, or a colon-separated list, and IPv6 needs "::" or a 3-4 digit group.
		if (!ip.includes("::") && !groups.some((g) => g.length >= 3)) continue;
		if (!IPV6_OK.some((re) => re.test(ip))) out.push(`${ip} (a routable address: a public repo must not name one)`);
	}
	return out;
}

/** Apply the rules to one line of text. Returns [{rule, why}] — empty when the line is clean.
 *  A line ending in `no-secrets: allow` is skipped: it is the rule's own pattern, or a synthetic
 *  fixture (a fake public address, a made-up tailnet name) that the extension's tests need. */
export function lineFindings(line) {
	if (line.includes("no-secrets: allow")) return [];
	const hits = [];
	for (const [rule, test] of RULES) {
		const why = typeof test === "function" ? test(line) : test.test(line) ? [test.source.slice(0, 60)] : null;
		for (const w of why ?? []) hits.push({ rule, why: w });
	}
	return hits;
}

/** Apply the rules to a whole text. Returns ["where:line: rule — why", …]. */
export function checkText(text, where = "<text>") {
	const out = [];
	if (text.includes("\0")) return out; // binary: not prose, not source
	for (const [i, line] of text.split("\n").entries())
		for (const h of lineFindings(line)) out.push(`${where}:${i + 1}: ${h.rule} — ${h.why}`);
	return out;
}

function filesToCheck(mode) {
	if (mode === "--staged")
		return execFileSync("git", ["diff", "--cached", "--name-only", "-z"], { cwd: REPO, encoding: "utf8" }).split("\0").filter(Boolean);
	// tracked, untracked and generated: everything a clone of this tree, or a run of the ticket
	// generators, can put in front of a public release. node_modules and .git are not repo content.
	const list = [];
	const walk = (dir) => {
		for (const d of readdirSync(dir, { withFileTypes: true })) {
			if (d.name === ".git" || d.name === "node_modules") continue;
			const p = join(dir, d.name);
			if (d.isDirectory()) walk(p);
			else if (d.isFile() && !statSync(p).isSymbolicLink()) list.push(relative(REPO, p));
		}
	};
	walk(REPO);
	return list;
}

if (process.argv[1] && process.argv[1].endsWith("no-secrets.mjs")) {
	const mode = process.argv[2] ?? "";
	const files = filesToCheck(mode);
	const findings = [];
	for (const f of files) {
		let text;
		try {
			text = readFileSync(join(REPO, f), "utf8");
		} catch {
			continue; // deleted between listing and reading
		}
		findings.push(...checkText(text, f));
	}
	if (findings.length) {
		console.log(`public-repo check: ${findings.length} finding(s) in ${files.length} files`);
		for (const f of findings) console.log(`  ${f}`);
		process.exit(1);
	}
	console.log(`no secrets, no keys, no personal paths, no routable addresses (${files.length} files)`);
}
