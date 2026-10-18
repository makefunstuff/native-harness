// verify-gate: before the agent settles after changing files, run the project's check command
// (.pi/verify, or the one AGENTS.md names) and, when it fails, hand the output back to the model
// for another round (at most PI_VERIFY_ROUNDS, default 2). Adds one prompt rule against tests that
// share the implementation's assumptions. Everything it adds is appended at the end of the
// session, never rewritten, so the prompt cache survives (hybrid Qwen models re-read everything
// after a change in history).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EDIT_TOOLS, TEST_RULE, failureMessage, findCheck, giveUpMessage, runCheck, treeFingerprint } from "./gate.ts";

export interface Config {
	gate: boolean;
	rule: boolean;
	rounds: number;
	timeoutMs: number;
	maxOutput: number;
}

// PI_VERIFY_GATE: on (default) | off | gate-only | rule-only
export function readConfig(env: Record<string, string | undefined> = process.env): Config {
	const mode = (env.PI_VERIFY_GATE ?? "on").toLowerCase();
	const off = ["0", "off", "false", "no"].includes(mode);
	const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
	return {
		gate: !off && mode !== "rule-only",
		rule: !off && mode !== "gate-only",
		rounds: Math.max(0, Math.floor(num(env.PI_VERIFY_ROUNDS, 2))),
		timeoutMs: num(env.PI_VERIFY_TIMEOUT, 300) * 1000,
		maxOutput: num(env.PI_VERIFY_MAX_OUTPUT, 4000),
	};
}

export const CUSTOM_TYPE = "verify-gate";

export default function (pi: ExtensionAPI) {
	verifyGate(pi, readConfig());
}

export function verifyGate(pi: ExtensionAPI, config: Config) {
	if (!config.gate && !config.rule) return;

	if (config.rule) {
		pi.on("before_agent_start", (event) => {
			const g = event.systemPromptOptions.promptGuidelines;
			if (!g.includes(TEST_RULE)) g.push(TEST_RULE);
		});
	}
	if (!config.gate) return;

	let edited = false; // an edit tool changed a file since the last check
	let baseline: string | undefined; // tree fingerprint at the last check or user prompt
	let rounds = 0; // continuations asked for since the last user prompt
	let warnedUntrusted = false;

	pi.on("session_start", () => {
		edited = false;
		baseline = undefined;
		rounds = 0;
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (event.messageType !== "user") return;
		rounds = 0;
		baseline = treeFingerprint(ctx.cwd); // changes the user made between prompts are not the agent's
	});

	pi.on("tool_result", (event) => {
		if (!event.isError && EDIT_TOOLS.has(event.toolName)) edited = true;
	});

	pi.on("agent_before_settle", async (event, ctx) => {
		if (event.outcome !== "completed" || event.continue) return; // aborted, failed, or another extension continues
		const changed = edited || (baseline !== undefined && treeFingerprint(ctx.cwd) !== baseline);
		if (!changed) return;
		const check = findCheck(ctx.cwd);
		if (!check) return;
		if (!ctx.isProjectTrusted()) {
			if (!warnedUntrusted) ctx.ui.notify(`verify-gate: not running ${check.source} in an untrusted project`, "warning");
			warnedUntrusted = true;
			return;
		}

		ctx.ui.setStatus(CUSTOM_TYPE, `verify-gate: ${check.label}`);
		const res = await runCheck(check, { timeoutMs: config.timeoutMs, env: { PI_VERIFY_GATE_ROUND: String(rounds) } });
		ctx.ui.setStatus(CUSTOM_TYPE, undefined);
		edited = false;
		baseline = treeFingerprint(ctx.cwd);

		const record = {
			type: "custom" as const,
			customType: CUSTOM_TYPE,
			data: { ok: res.ok, code: res.code, timedOut: res.timedOut, ms: res.ms, round: rounds, source: check.source, command: check.label },
		};
		if (res.ok) {
			if (rounds > 0) ctx.ui.notify(`verify-gate: check passes after ${rounds} round${rounds === 1 ? "" : "s"}`, "info");
			return { entries: [...event.entries, record] };
		}
		if (rounds >= config.rounds) {
			ctx.ui.notify(`verify-gate: check still fails (${check.label}); giving up after ${rounds} round${rounds === 1 ? "" : "s"}`, "warning");
			const note = { type: "custom_message" as const, customType: CUSTOM_TYPE, content: giveUpMessage(check, res, rounds), display: true };
			return { entries: [...event.entries, record, note] };
		}
		rounds++;
		const message = {
			type: "custom_message" as const,
			customType: CUSTOM_TYPE,
			content: failureMessage(check, res, rounds, config.rounds, config.maxOutput),
			display: true,
			details: record.data,
		};
		return { entries: [...event.entries, record, message], continue: true };
	});

	pi.registerCommand("verify", {
		description: "Run the project's check command now (verify-gate)",
		handler: async (_args, ctx) => {
			const check = findCheck(ctx.cwd);
			if (!check) {
				ctx.ui.notify("verify-gate: no check command (.pi/verify, or Verify: / ## Verify in AGENTS.md)", "warning");
				return;
			}
			ctx.ui.setStatus(CUSTOM_TYPE, `verify-gate: ${check.label}`);
			const res = await runCheck(check, { timeoutMs: config.timeoutMs });
			ctx.ui.setStatus(CUSTOM_TYPE, undefined);
			const tail = res.output.trimEnd().split("\n").slice(-15).join("\n");
			ctx.ui.notify(`verify-gate: ${check.label} (${check.source}) ${res.ok ? "passes" : "FAILS"} in ${(res.ms / 1000).toFixed(1)} s\n${tail}`, res.ok ? "info" : "error");
		},
	});
}
