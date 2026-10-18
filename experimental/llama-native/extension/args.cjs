// Read a llama-server argument file: one "--flag value" per line, # comments, ${VAR} expansion
// (defaults: MODEL_DIR=/data/hfmodels/gguf, HELPER_DIR=~/.cache/pi-extras/llama-native/models).
const { readFileSync } = require("node:fs");
const DEFAULTS = {
  MODEL_DIR: "/data/hfmodels/gguf",
  SLOT_DIR: require("node:path").join(require("node:os").homedir(), ".cache/pi-extras/llama-native/slots"),
  HELPER_DIR: require("node:path").join(require("node:os").homedir(), ".cache/pi-extras/llama-native/models"),
};
function readArgs(file, env = process.env) {
  const out = [];
  const subst = (s) => s.replace(/\$\{(\w+)\}/g, (_, k) => env[k] ?? DEFAULTS[k] ?? "");
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
