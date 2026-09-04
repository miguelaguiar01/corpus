// A client's importer: receives the pulled entries on stdin (§3, §8).
import { writeFileSync } from "node:fs";
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => writeFileSync("imported.json", raw));
