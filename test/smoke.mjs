#!/usr/bin/env node
// Headless smoke test: pi -p, on a throw-away copy of the pi config with this package installed,
// against a mock OpenAI-compatible model on loopback (no real model, so it runs in CI).
//
//   1. the package loads: every enabled extension, next to whatever the config already has, and
//      pi answers a prompt with no extension errors;
//   2. every *.smoke.mjs spec in the repo (see templates/extension/template.smoke.mjs).
//
// Environment: PI_EXTRAS_SMOKE_CONFIG=copy|empty (default: copy if ~/.pi/agent exists),
// PI_EXTRAS_SMOKE_SOURCE (config to copy), PI_BIN (pi binary), PI_EXTRAS_SMOKE_MCP=1 (keep MCP),
// PI_EXTRAS_SMOKE_MODEL=provider/id: run step 1 on that real model instead of the mock (step 2 is skipped).
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { MOCK_MODEL, REPO, configMode, makeAgentDir, piBin, removeAgentDir, runPi, startMockModel } from "./lib/harness.mjs";

// What pi prints when an extension fails to load or throws.
const EXTENSION_ERROR = /(failed to load extension|extension error|error loading extension|extension .* (failed|threw))/i;

let failed = 0;
async function check(name, fn) {
	const t0 = Date.now();
	try {
		await fn();
		console.log(`ok    ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
	} catch (e) {
		failed++;
		console.log(`FAIL  ${name}\n${String(e?.stack ?? e).replace(/^/gm, "      ")}`);
	}
}

function findSpecs() {
	const out = [];
	const walk = (dir) => {
		for (const d of readdirSync(dir, { withFileTypes: true })) {
			if (d.name === "node_modules" || d.name.startsWith(".")) continue;
			const p = join(dir, d.name);
			if (d.isDirectory()) walk(p);
			else if (d.name.endsWith(".smoke.mjs")) out.push(p);
		}
	};
	for (const r of ["extensions", "templates", "experimental/llama-native/extension"]) if (existsSync(join(REPO, r))) walk(join(REPO, r));
	return out;
}

async function runSpec(spec) {
	const realModel = spec.realModel;
	const mock = realModel ? null : await startMockModel(spec.respond);
	const agent = makeAgentDir({ mockUrl: mock?.url, extensions: spec.extensions });
	try {
		const res = await runPi(agent, ["-p", "--model", realModel ?? spec.model ?? MOCK_MODEL, ...(spec.args ?? []), spec.prompt], { timeoutMs: spec.timeoutMs });
		const out = `--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`;
		if (res.code !== 0) throw new Error(`pi exited with ${res.code ?? res.signal}\n${out}`);
		if (EXTENSION_ERROR.test(res.stderr + res.stdout)) throw new Error(`extension error reported\n${out}`);
		if (mock && mock.requests.length === 0) throw new Error(`the model was never called\n${out}`);
		try {
			await spec.check?.(res, mock);
		} catch (e) {
			e.message += `\n${out}`;
			throw e;
		}
	} finally {
		await mock?.close();
		removeAgentDir(agent);
	}
}

const realModel = process.env.PI_EXTRAS_SMOKE_MODEL;
console.log(`pi: ${piBin()}, config: ${configMode()}${realModel ? `, model: ${realModel}` : ", model: mock"}`);

await check("package loads and pi answers", () =>
	runSpec({
		prompt: "Reply with the word ready.",
		realModel,
		timeoutMs: realModel ? 600_000 : 120_000,
		respond: () => ({ content: "SMOKE_OK ready" }),
		check: ({ stdout }) => {
			if (!realModel && !stdout.includes("SMOKE_OK")) throw new Error("mock answer missing from output");
			if (realModel && !stdout.trim()) throw new Error("empty answer");
		},
	}),
);

if (!realModel) {
	for (const file of findSpecs()) {
		const spec = (await import(pathToFileURL(file).href)).default;
		await check(`${relative(REPO, file)}: ${spec.name ?? ""}`, () => runSpec(spec));
	}
}

if (failed) {
	console.log(`SMOKE FAILED (${failed})`);
	process.exit(1);
}
console.log("SMOKE OK");
