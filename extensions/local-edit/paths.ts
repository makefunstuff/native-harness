// Path repair for the local-edit extension: an edit path that does not exist is tried as
//   - path#tag, path:LINE, path:LINE-LINE, path#L12 (an anchor or line suffix pasted onto the path);
//   - a/path, b/path (git diff prefixes);
//   - a basename or a partial path, looked up under the working directory: used when exactly one
//     file ends with it.
// Returns the path to use and a note for the model, or an error listing the candidates.
import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const SKIP = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", "target", ".venv", "venv", "__pycache__", ".cache", ".next", ".tox"]);
const MAX_ENTRIES = 50_000;
const MAX_DEPTH = 12;

export interface PathResolution {
	path: string;
	note?: string;
	error?: string;
}

function expand(p: string, cwd: string): string {
	let q = p.startsWith("@") ? p.slice(1) : p;
	if (q === "~" || q.startsWith("~/")) q = join(process.env.HOME ?? "", q.slice(1));
	return isAbsolute(q) ? q : resolve(cwd, q);
}

const isFile = (abs: string) => {
	try {
		return statSync(abs).isFile();
	} catch {
		return false;
	}
};

/** Variants of the path with an anchor, line suffix or diff prefix taken off. */
export function strippedVariants(p: string): string[] {
	const out: string[] = [];
	const add = (q: string) => q && q !== p && !out.includes(q) && out.push(q);
	add(p.replace(/#.*$/, ""));
	add(p.replace(/:\d+(-\d+)?(:\d+)?$/, ""));
	add(p.replace(/^[ab]\//, ""));
	add(p.replace(/^[ab]\//, "").replace(/#.*$/, "").replace(/:\d+(-\d+)?(:\d+)?$/, ""));
	add(p.trim().replace(/^["'`]|["'`]$/g, ""));
	return out;
}

/** Files under root whose relative path ends with `tail` (a basename or partial path). */
export function findBySuffix(root: string, tail: string, limit = 20): string[] {
	const want = tail.replace(/^\.?\//, "").split(/[\\/]/).filter(Boolean);
	if (!want.length) return [];
	const found: string[] = [];
	let seen = 0;
	const walk = (dir: string, depth: number) => {
		if (depth > MAX_DEPTH || found.length >= limit || seen > MAX_ENTRIES) return;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const d of entries) {
			if (++seen > MAX_ENTRIES || found.length >= limit) return;
			if (d.isDirectory()) {
				if (!SKIP.has(d.name) && !d.name.startsWith(".")) walk(join(dir, d.name), depth + 1);
			} else if (d.isFile() && d.name === want[want.length - 1]) {
				const parts = relative(root, join(dir, d.name)).split(sep);
				if (want.every((w, i) => parts[parts.length - want.length + i] === w)) found.push(join(dir, d.name));
			}
		}
	};
	walk(root, 0);
	return found;
}

export function resolveEditPath(p: string, cwd: string): PathResolution {
	if (typeof p !== "string" || !p) return { path: p };
	if (existsSync(expand(p, cwd))) return { path: p };
	for (const q of strippedVariants(p)) {
		if (isFile(expand(q, cwd))) return { path: q, note: `path "${p}" taken as "${q}"` };
	}
	// basename / partial path: only for relative paths, or absolute ones inside cwd that do not exist
	const candidates = [p, ...strippedVariants(p)];
	for (const q of candidates) {
		const abs = expand(q, cwd);
		const tail = isAbsolute(q.replace(/^@/, "")) ? relative(cwd, abs) : q;
		if (!tail || tail.startsWith("..")) continue;
		const hits = findBySuffix(cwd, tail);
		const rel = hits.map((h) => relative(cwd, h));
		if (hits.length === 1) return { path: rel[0], note: `path "${p}" resolved to "${rel[0]}"` };
		if (hits.length > 1)
			return { path: p, error: `File not found: ${p}. Several files match; use the full path: ${rel.slice(0, 10).join(", ")}${hits.length > 10 ? ", …" : ""}` };
	}
	return { path: p };
}
