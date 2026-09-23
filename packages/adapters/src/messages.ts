import type { StringEntry } from "@corpus/contract";

// `arb`: Flutter's ARB is JSON whose top-level keys starting with "@"
// are metadata for their sibling ("@wallpaper", "@@locale"), not text
// (#558); a nested object under such a key is left alone.
// `keyIsText` is for the source-language file alone: a target file's
// empty value is an untranslated row, never the key.
export type MessagesOptions = {
  type: string;
  arb?: boolean;
  keyIsText?: boolean;
};

// The entries whose source is their key: an i18next catalogue with
// natural keys writes the sentence as the key and "" as the value, and
// the app falls back to the key (#589). Corpus reads the key as the
// text; build drops the file from such an entry, since a proposal would
// have nothing to write, and says how many took the key.
export const KEY_IS_TEXT = new WeakSet<StringEntry>();

// A key that is a sentence rather than a path: whitespace, or anything
// outside a dotted identifier. One such key with an empty value means
// the file uses natural keys, and then every empty value takes its key
// ("Email", "free", "Redeeming...") unless the key is a lowercase dotted
// path ("ui.title"), which stays empty.
export function keyIsSentence(id: string): boolean {
  return /\s/.test(id) || !/^[A-Za-z0-9_.:-]+$/.test(id);
}

const PLURAL_SUFFIX_RE = /_(?:zero|one|two|few|many|other)$/;

function keyIsPath(id: string): boolean {
  return /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(id);
}

function takeKeys(
  entries: StringEntry[],
  options: MessagesOptions,
): StringEntry[] {
  if (!options.keyIsText) return entries;
  const empty = entries.filter((entry) => entry.source === "");
  if (!empty.some((entry) => keyIsSentence(entry.id))) return entries;
  return entries.map((entry) => {
    if (entry.source !== "" || keyIsPath(entry.id)) return entry;
    // i18next resolves `key_one` and falls back to the key passed to
    // t(), which carries no suffix: the text is the base sentence.
    const keyed = { ...entry, source: entry.id.replace(PLURAL_SUFFIX_RE, "") };
    KEY_IS_TEXT.add(keyed);
    return keyed;
  });
}

// Flat or nested key-value catalog (already-parsed JSON/TS) -> snapshot
// string entries (§3). Nested keys flatten to dot-paths; the leaf string
// is the source, the flattened key is the stable id (§4). Input is
// `unknown` because it comes straight from JSON.parse: values must be
// strings, and a non-string leaf is a hard error naming its path, so a
// malformed catalog fails loudly rather than dropping strings silently.
export function messagesToEntries(
  data: unknown,
  options: MessagesOptions,
): StringEntry[] {
  const entries: StringEntry[] = [];
  if (
    options.arb &&
    data !== null &&
    typeof data === "object" &&
    !Array.isArray(data)
  ) {
    const record = data as Record<string, unknown>;
    const strings = Object.fromEntries(
      Object.entries(record).filter(([key]) => !key.startsWith("@")),
    );
    walk(strings, [], options.type, entries);
    // @key.description is the string's note (#567).
    return takeKeys(entries, options).map((entry) => {
      const meta = record[`@${entry.id}`];
      const description =
        meta && typeof meta === "object" && !Array.isArray(meta)
          ? (meta as Record<string, unknown>).description
          : undefined;
      if (typeof description !== "string" || description.trim() === "")
        return entry;
      const noted = { ...entry, note: description };
      if (KEY_IS_TEXT.has(entry)) KEY_IS_TEXT.add(noted);
      return noted;
    });
  }
  walk(data, [], options.type, entries);
  return takeKeys(entries, options);
}

function walk(
  node: unknown,
  path: string[],
  type: string,
  out: StringEntry[],
): void {
  if (typeof node === "string") {
    out.push({ id: path.join("."), type, source: node });
    return;
  }
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    throw new Error(
      `messages: value at ${path.join(".") || "<root>"} must be a string or nested object, got ${describe(node)}`,
    );
  }
  for (const [key, child] of Object.entries(node)) {
    walk(child, [...path, key], type, out);
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
