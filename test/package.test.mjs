// The package manifest: what pi reads on install.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { REPO, extensionDirs } from "./lib/harness.mjs";

const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
const HOST = ["@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"];

test("manifest lists the extension folders and the experimental extra", () => {
	assert.deepEqual(pkg.pi.extensions, ["./extensions/*/index.ts", "./experimental/llama-native/extension/index.ts"]);
	for (const d of extensionDirs()) assert.ok(existsSync(join(d, "index.ts")), `${d}/index.ts`);
});

// pi installs git packages with `npm install --omit=dev --omit=peer` and provides the host packages
// itself; a copy of them in node_modules would bypass its module mapping. Declaring them as peers
// next to the pi devDependency makes npm lock them as production packages, so they are dev-only.
test("host packages are never installed with the package", () => {
	for (const field of ["dependencies", "peerDependencies", "optionalDependencies"])
		for (const h of HOST) assert.ok(!pkg[field]?.[h], `${h} in ${field}`);
	const lock = JSON.parse(readFileSync(join(REPO, "package-lock.json"), "utf8"));
	const prod = Object.entries(lock.packages).filter(([k, v]) => k && !v.dev).map(([k]) => k);
	assert.deepEqual(prod, [], "packages a production install would add");
});
