// Smoke test for lessons, in a real pi process (mock model, file store):
//   - a seeded lesson whose cue matches the prompt is appended after the prompt, nothing else;
//   - a command fails, the model fixes it, it passes: at the end pi asks for a lesson;
//   - the answer (a new lesson, and the seeded one marked wrong) is stored: new note added,
//     contradicted note dropped.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MOCK_MODEL, textOf } from "../../test/lib/harness.mjs";

const dir = mkdtempSync(join(process.env.PI_EXTRAS_TMP ?? tmpdir(), "pi-extras-lessons-"));
const now = new Date().toISOString();
writeFileSync(
	join(dir, "smoke-repo.json"),
	JSON.stringify({
		repo: "smoke-repo",
		notes: [
			{ id: "lesson-seed", repo: "smoke-repo", cue: "running the widget check script", lesson: "create check.mjs first", evidence: "", confidence: 0.5, created: now, updated: now, hits: 1 },
			{ id: "lesson-other", repo: "smoke-repo", cue: "database migrations", lesson: "back up first", evidence: "", confidence: 0.9, created: now, updated: now, hits: 1 },
		],
	}),
);

const all = (body) => body.messages.map(textOf).join("\n");

export default {
	name: "lessons: recall at start, request after a fixed failure, store the answer",
	prompt: "Make the widget check script pass.",
	env: { LESSONS_STORE: "file", LESSONS_DIR: dir, LESSONS_REPO: "smoke-repo", LESSONS_JUDGE: "off" },
	respond(body, n) {
		if (n === 0) {
			const text = all(body);
			assert.match(text, /Lessons from earlier sessions in this repository/);
			assert.match(text, /L1\. When running the widget check script: create check\.mjs first/);
			assert.doesNotMatch(text, /database migrations/, "a lesson whose cue does not match is not shown");
			assert.doesNotMatch(JSON.stringify(body.messages[0] ?? {}), /Lessons from earlier/, "nothing added to the system prompt");
			return { toolCalls: [{ name: "bash", arguments: { command: "node check.mjs" } }] };
		}
		if (n === 1) return { toolCalls: [{ name: "bash", arguments: { command: "echo 'console.log(\"widgets ok\")' > check.mjs" } }] };
		if (n === 2) return { toolCalls: [{ name: "bash", arguments: { command: "node check.mjs" } }] };
		if (n === 3) return { content: "The check passes now." };
		const text = all(body);
		assert.match(text, /\[lessons\] Something failed in this session and was then fixed/);
		assert.match(text, /`node check\.mjs` failed/);
		assert.match(text, /Lessons L1 were shown/);
		return {
			content:
				"```lesson\ncue: running node check.mjs in this repository\nlesson: check.mjs is not committed; write it before running the check\nevidence: node check.mjs failed with module not found, passed after creating it\nconfidence: 0.7\n```\ncontradicts: L1",
		};
	},
	check(_res, mock) {
		assert.equal(mock.requests.length, 5, "one extra request for the lesson, no more");
		const notes = JSON.parse(readFileSync(join(dir, "smoke-repo.json"), "utf8")).notes;
		assert.deepEqual(notes.map((n) => n.id).includes("lesson-seed"), false, "contradicted lesson dropped");
		assert.ok(notes.some((n) => n.id === "lesson-other"));
		const fresh = notes.find((n) => n.cue === "running node check.mjs in this repository");
		assert.ok(fresh, "new lesson stored");
		assert.equal(fresh.confidence, 0.7);
	},
	model: MOCK_MODEL,
};
