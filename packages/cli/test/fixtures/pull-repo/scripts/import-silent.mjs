// An importer that honours CORPUS_PULL_CHECK but does not report what it changed.
import { writeFileSync } from "node:fs";
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  if (process.env.CORPUS_PULL_CHECK !== "1")
    writeFileSync("imported.json", raw);
});
