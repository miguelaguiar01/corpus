// corpus exec import: writes each translation the pull sent into its
// tip, and keeps every other text the file holds.
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "content/tips.json";
const payload = JSON.parse(readFileSync(0, "utf8"));
const tips = JSON.parse(readFileSync(FILE, "utf8"));
let changed = false;
for (const tip of tips) {
  for (const [language, texts] of Object.entries(payload.translations)) {
    const text = texts[`tip.${tip.id}`];
    if (text === undefined || tip.text[language] === text) continue;
    tip.text[language] = text;
    changed = true;
  }
}
// Under `pull --check` it says what it would change and writes nothing.
if (changed && process.env.CORPUS_PULL_CHECK !== "1")
  writeFileSync(FILE, `${JSON.stringify(tips, null, 2)}\n`);
console.log(JSON.stringify({ changed: changed ? [FILE] : [] }));
