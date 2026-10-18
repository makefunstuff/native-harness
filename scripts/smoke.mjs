// Smoke test of the addon without pi: load the preset, run one tool-calling chat turn and a
// decision on a branch, print timings. Usage: node scripts/smoke.mjs [extra llama args...]
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const m = require("../native/build/llama_native.node");

export function readArgs(file, env = process.env) {
  const out = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sp = line.indexOf(" ");
    const subst = (s) => s.replace(/\$\{(\w+)\}/g, (_, k) => env[k] ?? (k === "MODEL_DIR" ? "/data/hfmodels/gguf" : ""));
    if (sp < 0) out.push(subst(line));
    else out.push(subst(line.slice(0, sp)), subst(line.slice(sp + 1).trim()));
  }
  return out;
}

const args = [...readArgs(new URL("../configs/qwen3.8-27b.args", import.meta.url)), "--parallel", "2", ...process.argv.slice(2)];
let t = Date.now();
const h = await m.load(args);
console.log("loaded in", (Date.now() - t) / 1000, "s");
const tools = [{ type: "function", function: { name: "bash", description: "Run a shell command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } }];
const messages = [
  { role: "system", content: "You are a coding agent. Use the bash tool." },
  { role: "user", content: "How many lines does /etc/hostname have? Use the tool." },
];
let n = 0;
t = Date.now();
let r = JSON.parse(await m.chat(h, JSON.stringify({ messages, tools }), (d) => { n++; }));
console.log("turn1", (Date.now() - t) / 1000, "s deltas", n, JSON.stringify(r).slice(0, 1500));
messages.push({ role: "assistant", content: r.content, reasoning_content: r.reasoning_content,
  tool_calls: r.tool_calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) });
for (const c of r.tool_calls) messages.push({ role: "tool", tool_call_id: c.id, content: "1" });
t = Date.now();
r = JSON.parse(await m.chat(h, JSON.stringify({ messages, tools }), () => {}));
console.log("turn2", (Date.now() - t) / 1000, "s", JSON.stringify(r).slice(0, 1500));
messages.push({ role: "assistant", content: r.content, reasoning_content: r.reasoning_content });
t = Date.now();
const d = JSON.parse(await m.decide(h, JSON.stringify({ messages, tools, question: "Did you answer the question? A) yes B) no. Answer A or B.", labels: ["A", "B"] })));
console.log("decide", (Date.now() - t) / 1000, "s", JSON.stringify(d));
console.log("info", await m.info(h));
process.exit(0);
