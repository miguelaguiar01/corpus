import { closeSync, openSync, readSync } from "node:fs";
import path from "node:path";

const READ = new Set([
  ".json",
  ".arb",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
]);

const NAMED: Record<string, string> = {
  ".po": "a gettext catalogue",
  ".pot": "a gettext template",
  ".yml": "a YAML catalogue",
  ".yaml": "a YAML catalogue",
  ".xlf": "an XLIFF catalogue",
  ".xliff": "an XLIFF catalogue",
  ".xcstrings": "a String Catalog",
  ".strings": "an Apple .strings catalogue",
  ".stringsdict": "an Apple .stringsdict catalogue",
  ".properties": "a Java .properties catalogue",
  ".resx": "a .NET .resx catalogue",
};

const EXEC =
  "an exec source converts it (the wiki's Sources and adapters, exec)";

// Why a messages or table source cannot read a file, or null when it
// can (#647): Node's loader would otherwise fail on it with an error
// that names neither the format nor exec. `head` is the file's start,
// which tells Qt Linguist's XML `.ts` from TypeScript.
export function unreadableCatalogue(
  file: string,
  head?: string,
): string | null {
  const ext = path.extname(file).toLowerCase();
  if (
    ext === ".ts" &&
    head !== undefined &&
    /^\uFEFF?\s*<(\?xml|TS\b)/.test(head)
  )
    return `a Qt Linguist catalogue, which no adapter reads: ${EXEC}`;
  if (READ.has(ext)) return null;
  if (ext === ".ftl")
    return `a Fluent catalogue: declare it { adapter: "fluent", type, path }`;
  if (ext === ".xml")
    return `an XML file: Android's strings.xml is read by { adapter: "android", type, path: "<res directory>" }; for any other, ${EXEC}`;
  const named = NAMED[ext];
  if (named) return `${named}, which no adapter reads: ${EXEC}`;
  return `${ext || "a file without an extension"} is not a format any adapter reads: ${EXEC}`;
}

// The first bytes of a file, enough for unreadableCatalogue's `head`.
export function headOf(file: string): string {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(64);
    return buffer.toString("utf8", 0, readSync(fd, buffer, 0, 64, 0));
  } finally {
    closeSync(fd);
  }
}
