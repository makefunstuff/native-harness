// local-edit: pi's edit tool, made forgiving for local models, with clear failures.
//
// Replaces the built-in `edit` (same name, same schema, description and renderers, so the system
// prompt and the tool list stay byte-identical and the prompt cache is kept). Around pi's own
// implementation it adds:
//   - prepareArguments: argument repair before schema validation (aliases such as file_path /
//     old_string, a single edit object, edits as a JSON string), on a copy: the assistant message
//     in the history is never changed;
//   - path repair: path#tag, path:LINE, a/ b/ prefixes, and a basename or partial path when exactly
//     one file under the working directory matches (paths.ts);
//   - tolerant matching: indentation and >= 0.95 similarity, unique matches only (match.ts);
//   - on failure, the closest candidate lines with line numbers instead of "Could not find the
//     exact text";
//   - on success, a compact diff of removed and added lines, with a warning when code was dropped
//     (diff.ts).
// Everything it adds goes into the tool result, which is appended to the conversation.
import { createEditToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { compactDiff } from "./diff.ts";
import { EditMatchError, closestCandidates, resolveEdits, type Edit } from "./match.ts";
import { findTextElsewhere, resolveEditPath } from "./paths.ts";

const PATH_KEYS = ["path", "file_path", "filePath", "file", "filename", "file_name"];
const OLD_KEYS = ["oldText", "old_text", "old_string", "oldString", "old", "search", "find"];
const NEW_KEYS = ["newText", "new_text", "new_string", "newString", "new", "replace", "replacement"];

function pick(o: Record<string, unknown>, keys: string[]): unknown {
	for (const k of keys) if (o[k] !== undefined) return o[k];
	return undefined;
}

function repairEdit(e: unknown): unknown {
	if (!e || typeof e !== "object" || Array.isArray(e)) return e;
	const o = e as Record<string, unknown>;
	const oldText = pick(o, OLD_KEYS);
	const newText = pick(o, NEW_KEYS);
	if (typeof oldText !== "string") return e;
	// a missing newText stays missing: schema validation rejects it rather than deleting the text
	return typeof newText === "string" ? { oldText, newText } : { oldText };
}

/** Argument repair; returns a new object, never mutates the model's arguments. */
export function repairArguments(input: unknown, base?: (x: unknown) => unknown): unknown {
	if (!input || typeof input !== "object" || Array.isArray(input)) return input;
	const src = input as Record<string, unknown>;
	const args: Record<string, unknown> = {};
	const path = pick(src, PATH_KEYS);
	if (path !== undefined) args.path = path;
	let edits: unknown = src.edits;
	if (typeof edits === "string") {
		try {
			edits = JSON.parse(edits);
		} catch {}
	}
	if (edits && typeof edits === "object" && !Array.isArray(edits)) edits = [edits];
	if (Array.isArray(edits)) edits = edits.map(repairEdit);
	const single = repairEdit(src);
	if (single !== src) edits = [...(Array.isArray(edits) ? edits : []), single];
	if (edits !== undefined) args.edits = edits;
	for (const [k, v] of Object.entries(src))
		if (!(k in args) && k !== "edits" && !PATH_KEYS.includes(k) && !OLD_KEYS.includes(k) && !NEW_KEYS.includes(k)) args[k] = v;
	return base ? base(args) : args;
}

const normalizeLF = (t: string) => t.replace(/\r\n?/g, "\n");

function withText(result: any, extra: string[]): any {
	if (!extra.length) return result;
	const content = [...(result.content ?? [])];
	const i = content.findIndex((c: any) => c.type === "text");
	const text = extra.join("\n");
	if (i === -1) content.push({ type: "text", text });
	else content[i] = { ...content[i], text: `${content[i].text}\n${text}` };
	return { ...result, content };
}

export default function (pi: ExtensionAPI) {
	const base = createEditToolDefinition(process.cwd());
	pi.registerTool({
		...base,
		prepareArguments: (input: unknown) => repairArguments(input, base.prepareArguments as any),
		async execute(toolCallId: string, input: any, signal: any, onUpdate: any, ctx: any) {
			const cwd = ctx?.cwd || process.cwd();
			const notes: string[] = [];
			const p = resolveEditPath(input?.path, cwd);
			if (p.error) throw new Error(p.error);
			if (p.note) notes.push(p.note);
			let edits: Edit[] = input?.edits;
			let content: string | undefined;
			if (Array.isArray(edits) && edits.length) {
				const abs = isAbsolute(p.path) ? p.path : resolve(cwd, p.path.replace(/^@/, ""));
				try {
					content = normalizeLF((await readFile(abs, "utf-8")).replace(/^﻿/, ""));
				} catch {
					// missing or unreadable: pi reports it
				}
				if (content !== undefined) {
					try {
						const r = resolveEdits(content, edits, p.path);
						edits = r.edits;
						notes.push(...r.notes);
					} catch (e) {
						if (e instanceof EditMatchError) {
							let msg = e.message;
							if (/^Could not find/.test(msg)) {
								const missing = edits.find((x) => typeof x?.oldText === "string" && !content!.includes(normalizeLF(x.oldText)));
								const elsewhere = missing ? findTextElsewhere(cwd, normalizeLF(missing.oldText), abs) : [];
								if (elsewhere.length) msg += `\nThat oldText is in ${elsewhere.join(", ")}: did you mean ${elsewhere.length > 1 ? "one of these files" : "that file"}?`;
							}
							throw new Error(msg + (notes.length ? `\n(${notes.join("; ")})` : ""));
						}
						throw e;
					}
				}
			}
			let result;
			try {
				result = await base.execute(toolCallId, { ...input, path: p.path, edits }, signal, onUpdate, ctx);
			} catch (e: any) {
				// the file changed between our read and pi's, or a case we pass through: add candidates
				const msg = String(e?.message ?? e);
				if (/Could not find/.test(msg) && content !== undefined && edits?.length === 1)
					throw new Error(`${msg}\n${closestCandidates(content, normalizeLF(edits[0].oldText))}`);
				throw e;
			}
			const extra: string[] = [];
			if (notes.length) extra.push(`Note: ${notes.join("; ")}.`);
			const d = compactDiff(result?.details?.diff);
			if (d) extra.push(d.text);
			return withText(result, extra);
		},
	} as any);
}
