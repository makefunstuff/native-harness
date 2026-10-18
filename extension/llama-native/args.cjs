// Read a llama-server argument file: one "--flag value" per line, # comments, ${VAR} expansion
// (MODEL_DIR defaults to /data/hfmodels/gguf).
const { readFileSync } = require("node:fs");
function readArgs(file, env = process.env) {
  const out = [];
  const subst = (s) => s.replace(/\$\{(\w+)\}/g, (_, k) => env[k] ?? (k === "MODEL_DIR" ? "/data/hfmodels/gguf" : ""));
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sp = line.indexOf(" ");
    if (sp < 0) out.push(subst(line));
    else out.push(subst(line.slice(0, sp)), subst(line.slice(sp + 1).trim()));
  }
  return out;
}
module.exports = { readArgs };
