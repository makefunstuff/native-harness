// Template for a pi-extras extension. Copy this folder to extensions/<name>/, rename the tool,
// and replace the body. pi loads index.ts; keep logic in plain exported functions so the unit
// tests can call them without pi.
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function shout(text: string): string {
	return text.toUpperCase();
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "template_shout",
		label: "Shout",
		description: "Return the given text in upper case.",
		parameters: Type.Object({ text: Type.String({ description: "Text to shout" }) }),
		async execute(_toolCallId, params: { text: string }) {
			return { content: [{ type: "text", text: shout(params.text) }], details: {} };
		},
	});
}
