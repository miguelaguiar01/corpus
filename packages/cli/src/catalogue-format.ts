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
  ".strings": "an Apple .strings catalogue",
  ".stringsdict": "an Apple .stringsdict catalogue",
  ".properties": "a Java .properties catalogue",
  ".resx": "a .NET .resx catalogue",
};

const EXEC =
  "an exec source converts it (the wiki's Sources and adapters, exec)";

// Whether a `.ts` file's first bytes are Qt Linguist's XML, not
// TypeScript.
export function isQtLinguist(head: string): boolean {
  return /^\uFEFF?\s*<(\?xml|!DOCTYPE TS\b|TS\b)/.test(head);
}

// Why a messages or table source cannot read a file, or null when it
// can (#647): Node's loader would otherwise fail on it with an error
// that names neither the format nor exec. `head` is the file's start,
// which tells Qt Linguist's XML `.ts` from TypeScript.
export function unreadableCatalogue(
  file: string,
  head?: string,
): string | null {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".ts" && head !== undefined && isQtLinguist(head))
    return `a Qt Linguist catalogue: declare it { adapter: "qt-ts", type, path, sourcePath? }`;
  if (READ.has(ext)) return null;
  if (ext === ".po" || ext === ".pot")
    return `a gettext catalogue: declare it { adapter: "gettext", type, path, sourcePath? }`;
  if (ext === ".xlf" || ext === ".xliff")
    return `an XLIFF catalogue: declare it { adapter: "xliff", type, path, sourcePath? }`;
  if (ext === ".yml" || ext === ".yaml")
    return `a YAML catalogue: declare it { adapter: "yaml", type, path }`;
  if (ext === ".xcstrings")
    return `a String Catalog: declare it { adapter: "xcstrings", type, path }`;
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
