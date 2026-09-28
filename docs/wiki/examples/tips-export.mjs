// corpus exec export: each tip's English text is a string, and the
// languages a tip already holds are its translations.
import { readFileSync } from "node:fs";

const tips = JSON.parse(readFileSync("content/tips.json", "utf8"));
const strings = [];
const translations = {};
for (const tip of tips) {
  const id = `tip.${tip.id}`;
  strings.push({
    id,
    type: "tip",
    source: tip.text.en,
    ...(tip.note && { note: tip.note }),
  });
  for (const [language, text] of Object.entries(tip.text)) {
    if (language === "en") continue;
    translations[language] ??= {};
    translations[language][id] = text;
  }
}
process.stdout.write(JSON.stringify({ strings, translations }));
