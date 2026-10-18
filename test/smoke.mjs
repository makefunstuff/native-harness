#!/usr/bin/env node
// Headless smoke test: pi -p, on a throw-away copy of the pi config with this package installed
// the way users install it (`pi install git:github.com/makefunstuff/pi-extras`, served from a
// snapshot of the working tree, so no dev node_modules), against a mock OpenAI-compatible model on
// loopback (no real model, so it runs in CI).
//
//   1. the package loads: every enabled extension, next to whatever the config already has, and
//      pi answers a prompt with no extension errors;
//   2. the experimental llama-native extension loads its provider code in that install (with a
//      stand-in addon file: the addon itself is only opened on the first request);
//   3. every *.smoke.mjs spec in the repo (see templates/extension/template.smoke.mjs).
//
// Environment: PI_EXTRAS_SMOKE_CONFIG=copy|empty (default: copy if ~/.pi/agent exists),
// PI_EXTRAS_SMOKE_SOURCE (config to copy), PI_BIN (pi binary), PI_EXTRAS_SMOKE_MCP=1 (keep MCP),
// PI_EXTRAS_SMOKE_INSTALL=path (settings point at this checkout instead of a git install),
// PI_EXTRAS_SMOKE_MODEL=provider/id: run step 1 on that real model instead of the mock (steps 2-3 are skipped).
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
	const cwd = spec.cwd?.(); // a throw-away working directory the spec prepared, removed afterwards
	try {
		const res = await runPi(agent, ["-p", "--model", realModel ?? spec.model ?? MOCK_MODEL, ...(spec.args ?? []), spec.prompt], { timeoutMs: spec.timeoutMs, env: spec.env, cwd });
		const out = `--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`;
		if (res.code !== 0) throw new Error(`pi exited with ${res.code ?? res.signal}\n${out}`);
		if (EXTENSION_ERROR.test(res.stderr + res.stdout)) throw new Error(`extension error reported\n${out}`);
		if (mock && mock.requests.length === 0) throw new Error(`the model was never called\n${out}`);
		try {
			await spec.check?.(res, mock, cwd);
		} catch (e) {
			e.message += `\n${out}`;
			throw e;
		}
	} finally {
		await mock?.close();
		removeAgentDir(agent);
		if (cwd) rmSync(cwd, { recursive: true, force: true });
	}
}

const realModel = process.env.PI_EXTRAS_SMOKE_MODEL;
console.log(`pi: ${piBin()}, config: ${configMode()}, install: ${process.env.PI_EXTRAS_SMOKE_INSTALL ?? "git"}${realModel ? `, model: ${realModel}` : ", model: mock"}`);

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
	await check("llama-native provider loads in the installed package", async () => {
		const dir = mkdtempSync(join(process.env.PI_EXTRAS_TMP ?? tmpdir(), "pi-extras-addon-"));
		const addon = join(dir, "llama_native.node");
		writeFileSync(addon, "");
		const agent = makeAgentDir();
		try {
			const res = await runPi(agent, ["--list-models", "llama-native"], { env: { LLAMA_NATIVE_ADDON: addon } });
			const out = `--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`;
			if (res.code !== 0 || EXTENSION_ERROR.test(res.stderr + res.stdout)) throw new Error(`pi failed (${res.code ?? res.signal})\n${out}`);
			if (!/llama-native\s+qwen3\.8-27b/.test(res.stdout)) throw new Error(`llama-native model not listed\n${out}`);
		} finally {
			removeAgentDir(agent);
			rmSync(dir, { recursive: true, force: true });
		}
	});
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
