// The compact diff the local-edit extension appends to every successful edit result, so the model
// sees which lines it removed (an edit that silently drops neighbouring code shows up here).
//
// Input is pi's display diff (details.diff of the edit tool): "+NN text", "-NN text", " NN text"
// and " ... " gap markers. Output keeps one line of context around each change, caps the length,
// and warns when non-blank lines were removed without coming back, or newText looks abbreviated.

const CONTEXT = 1;
const MAX_LINES = 60;
const DROP_WARN = 3; // removed non-blank lines not re-added before warning
// newText that stands in for code instead of containing it ("// ... rest unchanged")
const PLACEHOLDER = /(\/\/|#|\/\*|<!--|--)\s*(\.\.\.|…)|(\.\.\.|…)\s*(rest|existing|remaining|unchanged|same|other)|\b(rest of (the )?(code|file|function|method|class)|existing code|remains? unchanged|unchanged code)\b/i;

interface DLine {
	kind: "+" | "-" | " " | "gap";
	text: string; // with the line number, as pi prints it
	body: string; // the source line
}

function parse(diff: string): DLine[] {
	return diff.split("\n").map((raw) => {
		const kind = raw[0];
		const m = /^.\s*\d+ ?(.*)$/.exec(raw);
		if ((kind === "+" || kind === "-" || kind === " ") && m) return { kind, text: raw, body: m[1] };
		return { kind: "gap", text: raw, body: "" };
	});
}

export interface DiffSummary {
	text: string;
	removed: number;
	added: number;
	dropped: number;
	placeholder: boolean;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

export function compactDiff(diff: string | undefined): DiffSummary | undefined {
	if (!diff) return undefined;
	const lines = parse(diff);
	const removed = lines.filter((l) => l.kind === "-");
	const added = lines.filter((l) => l.kind === "+");
	const addedSet = new Set(added.map((l) => norm(l.body)));
	const dropped = removed.filter((l) => norm(l.body) && !addedSet.has(norm(l.body))).length;
	const placeholder = added.some((l) => PLACEHOLDER.test(l.body)) && !removed.some((l) => PLACEHOLDER.test(l.body));
	const keep = lines.map(() => false);
	lines.forEach((l, i) => {
		if (l.kind !== "+" && l.kind !== "-") return;
		for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j++) keep[j] = true;
	});
	const out: string[] = [];
	let skipped = false;
	lines.forEach((l, i) => {
		if (keep[i] && l.kind !== "gap") {
			out.push(l.text);
			skipped = false;
		} else if (!skipped && out.length) {
			out.push("   …");
			skipped = true;
		}
	});
	while (out.length && out[out.length - 1] === "   …") out.pop();
	let shown = out;
	if (out.length > MAX_LINES) shown = [...out.slice(0, MAX_LINES), `   … ${out.length - MAX_LINES} more diff lines`];
	const head = `Diff (-${removed.length} +${added.length} lines; "-" = removed, "+" = added, numbers are line numbers):`;
	const warn: string[] = [];
	if (dropped >= DROP_WARN)
		warn.push(`Warning: ${dropped} non-blank line(s) were removed and not re-added. Check that removing them was intended; if not, restore them.`);
	if (placeholder)
		warn.push("Warning: the new text contains a placeholder comment (like \"// ... rest unchanged\"). The edit writes that comment literally; it does not keep the old code. Put the real code back.");
	return { text: [head, ...shown, ...warn].join("\n"), removed: removed.length, added: added.length, dropped, placeholder };
}
