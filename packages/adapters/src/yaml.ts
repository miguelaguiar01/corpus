// Rails I18n's YAML catalogues (#752): one file per language, the
// language as the root key, and strings as the scalars under it by
// their dotted path. Read with the `yaml` package's document model,
// which keeps every node where it is written, so a value that arrives
// only through an alias or a `<<:` merge is the anchor's and read once.
import type { StringEntry } from "@corpus/contract";
import {
  isAlias,
  isMap,
  isScalar,
  parseDocument,
  type Node,
  type Pair,
  type YAMLMap,
} from "yaml";

const PLURAL = ["zero", "one", "two", "few", "many", "other"] as const;

export type YamlString = {
  id: string;
  // The string's text, or its forms for a plural hash.
  text: string;
  plural?: Record<string, string>;
  // The comment written above its key, for a translator.
  note?: string;
};

// A key's text: a string key as it reads, a number as the file writes
// it (`01`, not 1), so a pull finds it again.
function keyOf(pair: Pair, text?: string): string | undefined {
  const key = pair.key;
  if (!isScalar(key)) return undefined;
  if (typeof key.value === "string") return key.value;
  if (typeof key.value === "number")
    return text !== undefined && key.range
      ? text.slice(key.range[0], key.range[1])
      : String(key.value);
  return undefined;
}

// A hash of plural categories, `other` among them, each a string: one
// plural, as Rails reads it (#662).
function pluralOf(map: YAMLMap): Record<string, string> | undefined {
  const forms: Record<string, string> = {};
  for (const pair of map.items) {
    const key = keyOf(pair);
    if (!key || !(PLURAL as readonly string[]).includes(key)) return undefined;
    // A form left null is one not yet written.
    if (isScalar(pair.value) && pair.value.value === null) continue;
    if (!isScalar(pair.value) || typeof pair.value.value !== "string")
      return undefined;
    forms[key] = pair.value.value;
  }
  return Object.hasOwn(forms, "other") ? forms : undefined;
}

// The strings under a language's root key, in the file's order; a key
// with no root is none. Nulls, numbers, booleans, lists and whatever an
// alias or a merge brings are not strings of their own.
export function yamlStrings(text: string, root: string): YamlString[] {
  const body = text.replace(/^\uFEFF/, "");
  const document = parseDocument(body, { uniqueKeys: false });
  if (document.errors.length > 0)
    throw new Error(document.errors[0]!.message.split("\n")[0]);
  const top = document.contents;
  // A file with no root for its language would build nothing and a
  // push archive every string: it is refused, naming what it holds.
  const roots = isMap(top) ? top.items.map((pair) => keyOf(pair, body)) : [];
  // Rails' parser keeps the last of a repeated root key.
  const rootPair = isMap(top)
    ? [...top.items].reverse().find((pair) => keyOf(pair, body) === root)
    : undefined;
  if (!rootPair || !isMap(rootPair.value))
    throw new Error(
      `no root key ${root}:${roots.length ? ` the file's root keys are ${roots.filter(Boolean).join(", ")}` : " the file has no root key"}; name its language's code in languageFiles`,
    );
  const out: YamlString[] = [];
  const walk = (map: YAMLMap, path: string[]) => {
    map.items.forEach((pair, index) => {
      const key = keyOf(pair, body);
      if (key === undefined || key === "<<") return;
      const value = pair.value as Node | null;
      if (!value || isAlias(value)) return;
      const id = [...path, key];
      // The parser gives a map's first key's comment to the map.
      const comment = (
        (pair.key as Node).commentBefore ??
        (index === 0 ? map.commentBefore : undefined)
      )?.trim();
      const note = comment ? { note: comment } : {};
      if (isScalar(value)) {
        if (typeof value.value === "string")
          out.push({ id: id.join("."), text: value.value, ...note });
      } else if (isMap(value)) {
        const plural = pluralOf(value);
        if (plural)
          out.push({
            id: id.join("."),
            text: pluralText(plural),
            plural,
            ...note,
          });
        else walk(value, id);
      }
    });
  };
  walk(rootPair.value, []);
  return out;
}

function pluralText(forms: Record<string, string>): string {
  const branches = PLURAL.filter((c) => Object.hasOwn(forms, c)).map(
    (c) => `${c} {${forms[c]}}`,
  );
  return `{count, plural, ${branches.join(" ")}}`;
}

// A `*_MF` key holds ICU MessageFormat, as Discourse's `I18n.messageFormat`
// reads it; every other string is the source's library.
function libraryOf(id: string): { library?: "icu" } {
  return /_MF$/.test(id) ? { library: "icu" } : {};
}

// The source file's strings.
export function yamlToEntries(
  text: string,
  options: { type: string; root: string },
): StringEntry[] {
  return yamlStrings(text, options.root).map((s) => ({
    id: s.id,
    type: options.type,
    source: s.text,
    ...libraryOf(s.id),
    ...(s.note && { note: s.note }),
  }));
}

// A target file's translations: its non-empty strings; a lone space,
// a number's delimiter, is one (build decides what seeds).
export function yamlTranslations(text: string, root: string): StringEntry[] {
  return yamlStrings(text, root).flatMap((s) =>
    s.text === "" ||
    (s.plural && Object.values(s.plural).every((f) => f === ""))
      ? []
      : [{ id: s.id, type: "", source: s.text }],
  );
}
