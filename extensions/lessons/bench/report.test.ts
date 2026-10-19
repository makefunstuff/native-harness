import assert from "node:assert/strict";
import { test } from "node:test";
import { type Row, fisher, report, summarise } from "./report.ts";

const row = (pos: number, mistakes: string[], extra: Partial<Row> = {}): Row => ({
	arm: "base",
	model: "m",
	seq: "s",
	ticket: `${pos}-t`,
	pos,
	round: 1,
	passed: true,
	traps_possible: ["a", "b", "c"],
	traps_seen: mistakes,
	traps_left: [],
	mistakes,
	assistant_turns: 10,
	tool_calls: 5,
	input_tokens: 100,
	cache_read_tokens: 900,
	output_tokens: 50,
	cost: 0.001,
	wall_s: 20,
	lessons_shown: 0,
	asked: false,
	ask_input: 0,
	ask_cache_read: 0,
	ask_output: 0,
	...extra,
});

test("repeated mistakes count rules broken again after an earlier ticket of the same run broke them", () => {
	const rows = [row(1, ["a"]), row(2, ["a", "b"]), row(3, ["b"]), row(4, []), { ...row(2, ["a"]), round: 2 }];
	const s = summarise("x", rows);
	// round 1: #2 has 1 opportunity (a), repeated; #3: a, b → b repeated; #4: a, b → none. round 2: #2 alone, a is new.
	assert.equal(s.opportunities, 5);
	assert.equal(s.repeated, 2);
	assert.equal(s.firstTickets, 1);
	assert.equal(s.firstMistakes, 1);
	assert.equal(s.laterTickets, 4);
	assert.equal(s.cleanLater, 1);
});

test("fisher exact test", () => {
	assert.ok(Math.abs(fisher(1, 9, 11, 3) - 0.0028) < 0.0005);
	assert.equal(fisher(5, 5, 5, 5), 1);
});

test("report renders a table and a comparison per model", () => {
	const md = report([row(1, ["a"]), row(2, ["a"]), { ...row(1, ["a"]), arm: "lessons" }, { ...row(2, [], { lessons_shown: 1 }), arm: "lessons" }]);
	assert.match(md, /\| base · m \| 2 \| 2 \| 1\/1 \(100 %\)/);
	assert.match(md, /\| lessons · m \| 2 \| 2 \| 0\/1 \(0 %\)/);
	assert.match(md, /lessons · m vs base · m: repeated 0\/1 vs 1\/1/);
});
