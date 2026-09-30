import {
  EXACT_KEY,
  PLURAL_CATEGORIES,
  pluralCategoriesOf,
  type StringEntry,
} from "@corpus/contract";

// `arb`: Flutter's ARB is JSON whose top-level keys starting with "@"
// are metadata for their sibling ("@wallpaper", "@@locale"), not text
// (#558); a nested object under such a key is left alone.
// `keyIsText` is for the source-language file alone: a target file's
// empty value is an untranslated row, never the key.
export type MessagesOptions = {
  type: string;
  arb?: boolean;
  chrome?: boolean;
  keyIsText?: boolean;
  // An object of plural categories is one plural string (#662), under a
  // library whose text can hold one: not vue, whose plurals are pipes.
  plurals?: PluralObjects;
  // The ids the source reads as plurals: in a target file an object of
  // categories is a plural exactly at one of them, `other` or not (#950,
  // #984), and so is a family of suffix keys.
  pluralIds?: ReadonlySet<string>;
  // i18next's plural keys, `item_one` and `item_other`, are one plural
  // string `item` (#985), in a source only of the categories its
  // language, `sourceLanguage`, picks.
  suffixPlurals?: boolean;
  sourceLanguage?: string;
};

const SUFFIX = /^(.+)_(zero|one|two|few|many|other)$/;

// An object's i18next plural families (#985): base to its forms' keys,
// each category's. In a source, keys `base_<category>` beside each other,
// `other` and one more among them, each a category the source language
// picks or `zero` (English's `reason_two` is a key), with no key `base`
// and no `_ordinal` in the base, which i18next picks by ordinal rules; in
// a target, the families the source has, `known`, whatever forms the
// target holds, a bare `base` beside one being no translation of it. A
// family whose forms could not come back out of one plural text stays
// keys.
export function suffixFamilies(
  node: Record<string, unknown>,
  path: string[],
  known?: ReadonlySet<string>,
  language?: string,
): Map<string, Map<string, string>> {
  const picked = language ? pluralCategoriesOf(language) : [];
  const groups = new Map<string, Map<string, string>>();
  for (const [key, value] of Object.entries(node)) {
    const m = SUFFIX.exec(key);
    if (!m || typeof value !== "string" || m[1]!.endsWith("_ordinal")) continue;
    const forms = groups.get(m[1]!) ?? new Map<string, string>();
    forms.set(m[2]!, key);
    groups.set(m[1]!, forms);
  }
  for (const [base, forms] of groups) {
    const id = [...path, base].join(".");
    const kept =
      (known
        ? known.has(id)
        : !Object.hasOwn(node, base) &&
          forms.has("other") &&
          forms.size >= 2 &&
          (picked.length === 0 ||
            [...forms.keys()].every(
              (c) => c === "zero" || picked.includes(c),
            ))) &&
      (() => {
        const text = Object.fromEntries(
          [...forms].map(([c, key]) => [c, node[key] as string]),
        );
        const back = pluralBranches(pluralText("count", text), false);
        return (
          back !== undefined &&
          [...forms].every(([c, key]) => back[c] === node[key])
        );
      })();
    if (!kept) groups.delete(base);
  }
  return groups;
}

// A family's text: its forms as one plural in CLDR's order, a blank form,
// which Crowdin writes for an untranslated one, none. A source's family
// of blanks is "", as i18next-parser writes a natural key's: its key is
// its text (#589).
export function suffixText(
  node: Record<string, unknown>,
  forms: Map<string, string>,
  source = false,
): string | undefined {
  const text: Record<string, string> = {};
  for (const [c, key] of forms) {
    const value = node[key] as string;
    if (value.trim() !== "") text[c] = value;
  }
  if (Object.keys(text).length > 0) return pluralText("count", text);
  return source ? "" : undefined;
}

// The ids of a source catalogue's i18next plural families (#985).
export function suffixPluralIds(
  node: unknown,
  language?: string,
  path: string[] = [],
  out = new Set<string>(),
): Set<string> {
  if (node === null || typeof node !== "object" || Array.isArray(node))
    return out;
  const record = node as Record<string, unknown>;
  for (const base of suffixFamilies(record, path, undefined, language).keys())
    out.add([...path, base].join("."));
  for (const [key, child] of Object.entries(record))
    suffixPluralIds(child, language, [...path, key], out);
  return out;
}

// How a library reads an object of plural categories: as nesting, as one
// plural, or, under i18next, as one only with two forms or more, since
// i18next reads an object as its path and a lone `{ other }` is a key
// (#984), while a catalogue its build turns into suffix keys writes
// `{ one, other }` (Rocket.Chat).
export type PluralObjects = boolean | "several";

// `{ one, other }`, as counterpart, easy_localization and Rails write a
// plural: every key a category and `other` among them, every value a
// string, matrix-web-i18n's own test (#662). Where the source already
// reads the id as a plural, a target's object needs no `other` (#950).
export function isPluralObject(
  node: unknown,
  needsOther = true,
  mode: PluralObjects = true,
): node is Record<string, string> {
  if (!mode || node === null || typeof node !== "object" || Array.isArray(node))
    return false;
  const entries = Object.entries(node);
  if (
    entries.length < (mode === "several" ? 2 : 1) ||
    (needsOther && !Object.hasOwn(node, "other")) ||
    !entries.every(
      ([key, value]) =>
        (PLURAL_CATEGORIES as readonly string[]).includes(key) &&
        typeof value === "string",
    )
  )
    return false;
  // Only forms that come back as they went: a form with a stray brace
  // could not be split out of the plural again, so its keys stay keys.
  const back = pluralBranches(
    pluralText("count", node as Record<string, string>, "written"),
    needsOther,
  );
  return (
    back !== undefined &&
    entries.every(([key, value]) => back[key] === value) &&
    Object.keys(back).length === entries.length
  );
}

// The ids a source catalogue holds as plural objects, as the writer
// finds them: a target's object at one needs no `other` (#950).
export function pluralObjectIds(
  node: unknown,
  mode: PluralObjects = true,
  path: string[] = [],
  out = new Set<string>(),
): Set<string> {
  if (path.length > 0 && isPluralObject(node, true, mode))
    return out.add(path.join("."));
  if (node !== null && typeof node === "object" && !Array.isArray(node))
    for (const [key, child] of Object.entries(node))
      pluralObjectIds(child, mode, [...path, key], out);
  return out;
}

// Whether a node at `id` is a plural: in a target whose source's plurals
// are known, exactly where the source has one, however few its forms (a
// Japanese `{ other }`); else by its own shape.
export function isPluralAt(
  node: unknown,
  id: string,
  mode: PluralObjects | undefined,
  known: ReadonlySet<string> | undefined,
): node is Record<string, string> {
  if (!mode) return false;
  return known
    ? known.has(id) && isPluralObject(node, false)
    : isPluralObject(node, true, mode);
}

// A value that holds no translation: blank, or a plural whose every form
// is, as a plural object of empty strings reads (#970).
export function isBlank(text: string): boolean {
  if (text.trim() === "") return true;
  const forms = pluralBranches(text, false);
  return (
    forms !== undefined && Object.values(forms).every((f) => f.trim() === "")
  );
}

// A plural's form for a category: its own branch, or `other`'s, which
// every runtime falls back to.
export function formOf(
  branches: Record<string, string>,
  category: string,
): string | undefined {
  return branches[category] ?? branches.other;
}

// A plural string's forms by category, as a plural object writes them:
// the branches of `{count, plural, …}` with their text as written,
// braces balanced; undefined for any other text.
export function pluralBranches(
  text: string,
  needsOther = true,
  // `=N` branches too, which a gettext file's own forms can be (#982).
  exact = false,
): Record<string, string> | undefined {
  const head = /^\s*\{\s*count\s*,\s*plural\s*,/.exec(text);
  if (!head) return undefined;
  const forms: Record<string, string> = {};
  let at = head[0].length;
  for (;;) {
    while (/\s/.test(text[at] ?? "")) at++;
    if (text[at] === "}") {
      return text.slice(at + 1).trim() === "" &&
        Object.keys(forms).length > 0 &&
        (!needsOther || Object.hasOwn(forms, "other"))
        ? forms
        : undefined;
    }
    const open = text.indexOf("{", at);
    if (open < 0) return undefined;
    const key = text.slice(at, open).trim();
    if (
      !/^(?:zero|one|two|few|many|other)$/.test(key) &&
      !(exact && EXACT_KEY.test(key))
    )
      return undefined;
    let depth = 0;
    let end = open;
    for (; end < text.length; end++) {
      if (text[end] === "{") depth++;
      else if (text[end] === "}" && --depth === 0) break;
    }
    if (end >= text.length) return undefined;
    forms[key] = text.slice(open + 1, end);
    at = end + 1;
  }
}

// A plural's text, `{arg, plural, …}`: its forms in CLDR's order, or in
// the order written where that order is the text's own, a JSON object's
// becoming the string's source.
export function pluralText(
  arg: string,
  forms: Record<string, string>,
  order: "cldr" | "written" = "cldr",
): string {
  // CLDR's categories first; any other key after them, as written.
  const keys =
    order === "cldr"
      ? [
          ...PLURAL_CATEGORIES.filter((c) => Object.hasOwn(forms, c)),
          ...Object.keys(forms).filter(
            (k) => !(PLURAL_CATEGORIES as readonly string[]).includes(k),
          ),
        ]
      : Object.keys(forms);
  return pluralFrom(
    arg,
    keys.map((k) => [k, forms[k]!]),
  );
}

// The plural text of branches as given, in order, a key repeated
// included: what a file writes, read as it is.
export function pluralFrom(arg: string, branches: [string, string][]): string {
  return `{${arg}, plural, ${branches.map(([k, text]) => `${k} {${text}}`).join(" ")}}`;
}

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

// An entry whose source is its key carries `keyIsText` (§4): an i18next
// catalogue with natural keys writes the sentence as the key and "" as
// the value, and the app falls back to the key (#589). Corpus reads the
// key as the text; build drops the file from such an entry, since a
// proposal would have nothing to write, and says how many took the key.
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
    return {
      ...entry,
      source: entry.id.replace(PLURAL_SUFFIX_RE, ""),
      keyIsText: true,
    };
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
  if (options.chrome) return chromeEntries(data, options.type);
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
    walk(strings, [], options, entries);
    // @key.description is the string's note (#567).
    return takeKeys(entries, options).map((entry) => {
      const meta = record[`@${entry.id}`];
      const description =
        meta && typeof meta === "object" && !Array.isArray(meta)
          ? (meta as Record<string, unknown>).description
          : undefined;
      if (typeof description !== "string" || description.trim() === "")
        return entry;
      return { ...entry, note: description };
    });
  }
  walk(data, [], options, entries);
  return takeKeys(entries, options);
}

type ChromeMessage = {
  message: string;
  description?: unknown;
  placeholders?: unknown;
};

// Chrome i18n's `_locales/{lang}/messages.json` (#595): every top-level
// value an object with a string `message`. Read so only under `library:
// "chrome"`, since a nested catalogue of `{ title, message }` has the
// same shape; init uses it to name the library.
export function isChromeMessages(
  data: unknown,
): data is Record<string, ChromeMessage> {
  if (data === null || typeof data !== "object" || Array.isArray(data))
    return false;
  const values = Object.values(data);
  return (
    values.length > 0 &&
    values.every(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        typeof (value as { message?: unknown }).message === "string",
    )
  );
}

function chromeEntries(data: unknown, type: string): StringEntry[] {
  if (
    data !== null &&
    typeof data === "object" &&
    Object.keys(data).length === 0
  )
    return [];
  if (!isChromeMessages(data)) {
    throw new Error(
      `messages: under library chrome every value must be an object with a string message`,
    );
  }
  return Object.entries(data).map(([id, value]) => {
    const entry: StringEntry = { id, type, source: value.message };
    if (typeof value.description === "string" && value.description.trim())
      entry.note = value.description;
    const values = chromeExamples(value.placeholders);
    if (Object.keys(values).length > 0) {
      entry.examples = [
        { values, rendered: renderChrome(value.message, values) },
      ];
    }
    return entry;
  });
}

function chromeExamples(placeholders: unknown): Record<string, string> {
  // A placeholder's name is data: `__proto__` a name like any (#878).
  const values = Object.create(null) as Record<string, string>;
  if (placeholders === null || typeof placeholders !== "object") return values;
  for (const [name, spec] of Object.entries(placeholders)) {
    const example = (spec as { example?: unknown } | null)?.example;
    if (typeof example === "string") values[name.toLowerCase()] = example;
  }
  return values;
}

function renderChrome(message: string, values: Record<string, string>): string {
  return message.replace(
    /\$\$|\$([A-Za-z0-9_]+)\$/g,
    (written, name?: string) =>
      name === undefined ? "$" : (values[name.toLowerCase()] ?? written),
  );
}

// Two key paths that flatten to one id (`"a.b": { "c" }` and
// `"a": { "b.c" }`) would be one string written to one place (#642).
function walk(
  node: unknown,
  path: string[],
  options: MessagesOptions,
  out: StringEntry[],
  paths = new Map<string, string[]>(),
): void {
  const type = options.type;
  if (
    path.length > 0 &&
    isPluralAt(node, path.join("."), options.plurals, options.pluralIds)
  )
    node = pluralText("count", node, "written");
  if (typeof node === "string") {
    const id = path.join(".");
    const first = paths.get(id);
    if (first) {
      throw new Error(
        // The id escaped as its paths are: a msgid may span lines (#648).
        `messages: ${JSON.stringify(id).slice(1, -1)} is written twice: ${JSON.stringify(first)} and ${JSON.stringify(path)}`,
      );
    }
    paths.set(id, path);
    out.push({ id, type, source: node });
    return;
  }
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    throw new Error(
      `messages: value at ${path.join(".") || "<root>"} must be a string or nested object, got ${describe(node)}`,
    );
  }
  const record = node as Record<string, unknown>;
  const families = options.suffixPlurals
    ? suffixFamilies(record, path, options.pluralIds, options.sourceLanguage)
    : new Map<string, Map<string, string>>();
  const member = new Map<string, string>();
  for (const [base, forms] of families)
    for (const key of forms.values()) member.set(key, base);
  for (const [key, child] of Object.entries(record)) {
    if (families.has(key)) continue;
    const base = member.get(key);
    if (base === undefined) {
      walk(child, [...path, key], options, out, paths);
      continue;
    }
    // The family reads where its first form is written.
    const forms = families.get(base)!;
    if ([...forms.values()][0] !== key) continue;
    const text = suffixText(record, forms, !options.pluralIds);
    if (text !== undefined) walk(text, [...path, base], options, out, paths);
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
