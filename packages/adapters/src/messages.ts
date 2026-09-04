import type { StringEntry } from "@corpus/contract";

export type MessagesOptions = { type: string };

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
  walk(data, [], options.type, entries);
  return entries;
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
