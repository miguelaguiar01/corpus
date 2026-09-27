// A client's importer: receives the pulled entries on stdin (§3, §8),
// and says which files it changed as its last stdout line (#659). Under
// --check it reports and writes nothing.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const same =
    existsSync("imported.json") &&
    readFileSync("imported.json", "utf8") === raw;
  if (!process.argv.includes("--check") && !same) {
    writeFileSync("imported.json", raw);
    process.stderr.write("import: wrote imported.json\n");
  }
  console.log(JSON.stringify({ changed: same ? [] : ["imported.json"] }));
});
