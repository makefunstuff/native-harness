#!/usr/bin/env node
// The notes for a GitHub release, from CHANGELOG.md, put through the public-repo rules.
//
//   node scripts/release-notes.mjs 0.1.0            print the notes
//   node scripts/release-notes.mjs v0.1.0 notes.md  write them (a leading "v" is accepted)
//
// The section is "## <version> …" up to the next "## ", the install line is appended, and
// scripts/no-secrets.mjs checks the result: a release is public, so its notes may carry no secret,
// key, personal path, routable address or tailnet hostname. The version must match package.json.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../test/lib/harness.mjs";
import { checkText } from "./no-secrets.mjs";

/** The section of a changelog for one version: "## 0.1.0 — 2026-10-20" to the next "## ". */
export function sectionFor(changelog, version) {
	const lines = changelog.split("\n");
	const head = new RegExp(`^## v?${version.replace(/\./g, "\\.")}(\\s|$)`);
	const start = lines.findIndex((l) => head.test(l));
	if (start < 0) return null;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break; }
	return lines.slice(start + 1, end).join("\n").trim();
}

/** The release notes for a version: its changelog section, the install line, and a title. */
export function notesFor({ changelog, pkg, tag }) {
	const version = tag.replace(/^v/, "");
	if (pkg.version !== version) throw new Error(`package.json is ${pkg.version}, the release is ${version}`);
	const body = sectionFor(changelog, version);
	if (body === null) throw new Error(`CHANGELOG.md has no "## ${version}" section`);
	const install = `\`pi install git:${(pkg.repository?.url ?? "").replace(/^git\+https:\/\//, "").replace(/\.git$/, "")}@${tag}\``;
	return [`# ${tag}`, "", body, "", `Install: ${install}`, ""].join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("release-notes.mjs")) {
	const tag = process.argv[2];
	const out = process.argv[3];
	if (!tag) {
		console.error("usage: node scripts/release-notes.mjs <version|vversion> [out.md]");
		process.exit(2);
	}
	const notes = notesFor({
		changelog: readFileSync(join(REPO, "CHANGELOG.md"), "utf8"),
		pkg: JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")),
		tag,
	});
	const findings = checkText(notes, "release notes");
	if (findings.length) {
		console.log(`release notes fail the public-repo check (${findings.length} finding(s)):`);
		for (const f of findings) console.log(`  ${f}`);
		process.exit(1);
	}
	if (out) writeFileSync(out, notes);
	else process.stdout.write(notes);
	console.log(`${out}: ${notes.split("\n").length} lines, public-repo check ok`);
}
