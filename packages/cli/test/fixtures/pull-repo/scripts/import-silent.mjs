// An importer that honours --check but does not report what it changed.
import { writeFileSync } from "node:fs";
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  if (!process.argv.includes("--check")) writeFileSync("imported.json", raw);
});
