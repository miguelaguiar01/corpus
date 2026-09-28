// Apple's String Catalog, `.xcstrings` (#727): one JSON file holding
// every language. A key is a string; `localizations.<lang>` is that
// language's unit, a `stringUnit`, `variations` by plural category,
// device or width, or a `stringUnit` whose `%#@name@` substitutions are
// plurals of their own.
import type { StringEntry } from "@corpus/contract";

type StringUnit = { state?: string; value?: string };

export type XcUnit = {
  stringUnit?: StringUnit;
  variations?: Record<string, Record<string, XcUnit>>;
  substitutions?: Record<
    string,
    {
      argNum?: number;
      formatSpecifier?: string;
      variations?: Record<string, Record<string, XcUnit>>;
    }
  >;
};

export type XcCatalog = {
  sourceLanguage: string;
  version?: string;
  strings: Record<
    string,
    {
      comment?: string;
      extractionState?: string;
      shouldTranslate?: boolean;
      localizations?: Record<string, XcUnit>;
    }
  >;
};

export function parseXcstrings(text: string): XcCatalog {
  const data = JSON.parse(text.replace(/^\uFEFF/, "")) as Partial<XcCatalog>;
  if (
    typeof data !== "object" ||
    data === null ||
    typeof data.sourceLanguage !== "string" ||
    typeof data.strings !== "object" ||
    data.strings === null ||
    Array.isArray(data.strings)
  )
    throw new Error(
      "not a String Catalog: it has no sourceLanguage and strings",
    );
  return data as XcCatalog;
}

// A text and whether every unit in it is translated, for one variant.
type Read = { suffix: string; text: string; done: boolean };

const done = (unit: StringUnit | undefined) => unit?.state === "translated";

function pluralText(arg: string, forms: Record<string, XcUnit>): Read {
  const branches = Object.entries(forms).map(
    ([category, unit]) => `${category} {${unit.stringUnit?.value ?? ""}}`,
  );
  return {
    suffix: "",
    text: `{${arg}, plural, ${branches.join(" ")}}`,
    done: Object.values(forms).every((unit) => done(unit.stringUnit)),
  };
}

// printf's verbs, `%%` a literal and `%#@name@` a substitution, each
// taking the next argument unless it names its own with `%n$`.
const VERB =
  /%(?:(\d+)\$)?(?:#@([^@\s]+)@|[-+0# ]*\d*(?:\.\d+)?(?:hh|h|ll|l|z|j|t|q|L)?[a-zA-Z@])|%%/g;

// A substitution's name is the unit's own (`arg1` in English,
// `count_posts` in Polish, for one argument), so its plural is named by
// the argument it formats, `argN`: its `argNum`, or the position its
// `%#@name@` takes among the verbs.
function substituted(unit: XcUnit): Read {
  const value = unit.stringUnit?.value ?? "";
  const subs = unit.substitutions ?? {};
  const argOf = new Map<string, number>();
  let next = 1;
  for (const m of value.matchAll(VERB)) {
    if (m[0] === "%%") continue;
    const position = m[1] ? Number(m[1]) : next;
    next = position + 1;
    if (m[2] && !argOf.has(m[2]))
      argOf.set(m[2], subs[m[2]]?.argNum ?? position);
  }
  let complete = done(unit.stringUnit);
  const text = value.replace(
    /%(?:\d+\$)?#@([^@\s]+)@/g,
    (whole, name: string) => {
      const plural = subs[name]?.variations?.plural;
      if (!plural) return whole;
      const read = pluralText(`arg${argOf.get(name) ?? 1}`, plural);
      complete &&= read.done;
      return read.text;
    },
  );
  return { suffix: "", text, done: complete };
}

// A unit's texts: one, or one per device or width variant, each named
// by a suffix on the key, `settings.platform [device:iphone]`.
export function unitTexts(unit: XcUnit): Read[] {
  const variations = unit.variations ?? {};
  for (const kind of ["device", "width"] as const) {
    const variants = variations[kind];
    if (variants)
      return Object.entries(variants).flatMap(([name, inner]) =>
        unitTexts(inner).map((read) => ({
          ...read,
          suffix: ` [${kind}:${name}]${read.suffix}`,
        })),
      );
  }
  if (variations.plural) return [pluralText("count", variations.plural)];
  if (unit.substitutions) return [substituted(unit)];
  if (unit.stringUnit)
    return [
      {
        suffix: "",
        text: unit.stringUnit.value ?? "",
        done: done(unit.stringUnit),
      },
    ];
  return [];
}

// The keys a catalogue offers for translation: not the empty key, one
// Xcode marked stale, nor one marked not to translate.
function live(catalog: XcCatalog) {
  return Object.entries(catalog.strings).filter(
    ([key, entry]) =>
      key !== "" &&
      entry.extractionState !== "stale" &&
      entry.shouldTranslate !== false,
  );
}

// A key's source texts. A key with no unit in the source language, or
// an empty one, is its own text, as Xcode reads it (`Text("Bookmarks")`).
function sourceReads(
  catalog: XcCatalog,
  key: string,
): (Read & { keyIsText?: true })[] {
  const unit = catalog.strings[key]?.localizations?.[catalog.sourceLanguage];
  const reads = unit ? unitTexts(unit) : [];
  if (reads.length === 0 || (reads.length === 1 && reads[0]!.text === ""))
    return [{ suffix: "", text: key, done: true, keyIsText: true }];
  return reads;
}

// The catalogue's strings in its source language, which must be the
// one the config names.
export function xcstringsToEntries(
  text: string,
  options: { type: string; sourceLanguage?: string },
): StringEntry[] {
  const catalog = parseXcstrings(text);
  if (
    options.sourceLanguage !== undefined &&
    catalog.sourceLanguage !== options.sourceLanguage
  )
    throw new Error(
      `the catalogue's sourceLanguage is ${catalog.sourceLanguage}, the config's ${options.sourceLanguage}`,
    );
  return live(catalog).flatMap(([key, entry]) => {
    const note = entry.comment ? { note: entry.comment } : {};
    return sourceReads(catalog, key).map((read) => ({
      id: key + read.suffix,
      type: options.type,
      source: read.text,
      ...(read.keyIsText && { keyIsText: true }),
      ...note,
    }));
  });
}

// A language's translations: the units marked translated throughout;
// one still `new` or `needs_review` in any form is work, not a seed.
// A language may vary by device where the source does not, or not where
// it does: its text lands on the source's own strings, a plain one on
// each variant, a varied one's `other` device on the plain string.
export function xcstringsTranslations(
  text: string,
  language: string,
): StringEntry[] {
  const catalog = parseXcstrings(text);
  return live(catalog).flatMap(([key, entry]) => {
    const unit = entry.localizations?.[language];
    if (!unit) return [];
    const wanted = sourceReads(catalog, key).map((read) => read.suffix);
    const reads = unitTexts(unit);
    const shaped =
      reads.length === 1 && reads[0]!.suffix === "" && wanted[0] !== ""
        ? wanted.map((suffix) => ({ ...reads[0]!, suffix }))
        : wanted.length === 1 && wanted[0] === ""
          ? reads
              .filter(
                (read) =>
                  read.suffix === "" || read.suffix === " [device:other]",
              )
              .slice(-1)
              .map((read) => ({ ...read, suffix: "" }))
          : reads.filter((read) => wanted.includes(read.suffix));
    return shaped
      .filter((read) => read.done && read.text !== "")
      .map((read) => ({ id: key + read.suffix, type: "", source: read.text }));
  });
}

// The languages a catalogue holds, its source first.
export function xcstringsLanguages(text: string): string[] {
  const catalog = parseXcstrings(text);
  const found = new Set<string>();
  for (const entry of Object.values(catalog.strings))
    for (const language of Object.keys(entry.localizations ?? {}))
      found.add(language);
  found.delete(catalog.sourceLanguage);
  return [catalog.sourceLanguage, ...[...found].sort()];
}

// Xcode's layout for a String Catalog: two-space indent, `"k" : v`,
// UTF-8 as it is, an empty object or array with a blank line inside.
export function serializeXcstrings(value: unknown, indent = ""): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value))
    return value.length === 0
      ? `[\n\n${indent}]`
      : `[\n${value.map((v) => inner + serializeXcstrings(v, inner)).join(",\n")}\n${indent}]`;
  const keys = Object.keys(value);
  if (keys.length === 0) return `{\n\n${indent}}`;
  return `{\n${keys
    .map(
      (k) =>
        `${inner}${JSON.stringify(k)} : ${serializeXcstrings((value as Record<string, unknown>)[k], inner)}`,
    )
    .join(",\n")}\n${indent}}`;
}

const sorted = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

const translated = (value: string): XcUnit => ({
  stringUnit: { state: "translated", value },
});

type Part = string | { arg: string; branches: Record<string, string> };

// The plurals Corpus reads a unit as, `{count, plural, …}` or
// `{argN, plural, …}`, among the text around them; any other brace is
// printf text.
function partsOf(text: string): Part[] {
  const parts: Part[] = [];
  let literal = "";
  let at = 0;
  while (at < text.length) {
    const open = /^\{\s*(count|arg\d+)\s*,\s*plural\s*,/.exec(text.slice(at));
    if (!open) {
      literal += text[at++];
      continue;
    }
    let i = at + open[0].length;
    const branches: Record<string, string> = {};
    for (;;) {
      while (/\s/.test(text[i] ?? "")) i++;
      if (text[i] === "}") {
        i++;
        break;
      }
      const key = /^([a-z]+|=\d+)\s*\{/.exec(text.slice(i));
      if (!key) return [text];
      i += key[0].length;
      let depth = 1;
      let body = "";
      while (i < text.length) {
        const ch = text[i++]!;
        if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) break;
        body += ch;
      }
      if (depth !== 0) return [text];
      branches[key[1]!] = body;
    }
    if (literal) parts.push(literal);
    literal = "";
    parts.push({ arg: open[1]!, branches });
    at = i;
  }
  if (literal) parts.push(literal);
  return parts;
}

// Each substitution of a unit by the argument it formats, `argN`.
function namesOf(unit: XcUnit | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const value = unit?.stringUnit?.value;
  if (!unit?.substitutions || value === undefined) return out;
  let next = 1;
  for (const m of value.matchAll(VERB)) {
    if (m[0] === "%%") continue;
    const position = m[1] ? Number(m[1]) : next;
    next = position + 1;
    if (m[2])
      out.set(`arg${unit.substitutions[m[2]]?.argNum ?? position}`, m[2]);
  }
  return out;
}

// A text as a unit, shaped as the unit it replaces or the source's: a
// plural on count is `variations.plural`, plurals on arguments are
// substitutions under the unit's own names, its `argNum` and
// `formatSpecifier` kept.
function unitOf(
  text: string,
  like: XcUnit | undefined,
  source: XcUnit | undefined,
): XcUnit {
  const parts = partsOf(text);
  const plurals = parts.filter(
    (p): p is Exclude<Part, string> => typeof p !== "string",
  );
  if (plurals.length === 0) return translated(text);
  const forms = (branches: Record<string, string>) =>
    sorted(
      Object.fromEntries(
        Object.entries(branches).map(([k, v]) => [k, translated(v)]),
      ),
    );
  if (parts.length === 1 && plurals[0]!.arg === "count")
    return { variations: { plural: forms(plurals[0]!.branches) } };
  const own = namesOf(like);
  const theirs = namesOf(source);
  const nameOf = (arg: string) => own.get(arg) ?? theirs.get(arg) ?? arg;
  const substitutions: NonNullable<XcUnit["substitutions"]> = {};
  for (const plural of plurals) {
    const name = nameOf(plural.arg);
    const before =
      like?.substitutions?.[name] ??
      source?.substitutions?.[theirs.get(plural.arg) ?? name];
    substitutions[name] = {
      ...(before?.argNum !== undefined && { argNum: before.argNum }),
      formatSpecifier: before?.formatSpecifier ?? "lld",
      variations: { plural: forms(plural.branches) },
    };
  }
  return {
    stringUnit: {
      state: "translated",
      value: parts
        .map((p) => (typeof p === "string" ? p : `%#@${nameOf(p.arg)}@`))
        .join(""),
    },
    substitutions: sorted(substitutions),
  };
}

// Pull's write into a String Catalog (§8): each changed text into its
// key's unit for the language, `state` translated, in Xcode's layout; a
// language that varies by device where the source does not keeps its
// variants, the plain text going to `other`, one that does not vary
// where the source does stays plain while every variant reads the
// same; a key the file lacks is not added. A file Xcode's layout does
// not reproduce is refused rather than moved.
export function entriesToXcstrings(
  text: string,
  translations: Record<string, string>,
  language: string,
): string {
  const catalog = parseXcstrings(text);
  const current = new Map(
    xcstringsTranslations(text, language).map((e) => [e.id, e.source]),
  );
  let changed = false;
  for (const [key, entry] of live(catalog)) {
    const wanted = sourceReads(catalog, key);
    const texts = new Map<string, string>();
    for (const read of wanted) {
      const t = translations[key + read.suffix];
      if (t !== undefined && current.get(key + read.suffix) !== t)
        texts.set(read.suffix, t);
    }
    if (texts.size === 0) continue;
    changed = true;
    const source = entry.localizations?.[catalog.sourceLanguage];
    const localizations = (entry.localizations ??= {});
    const had = localizations[language];
    const variants = (unit: XcUnit | undefined) =>
      unit?.variations?.device ?? unit?.variations?.width;
    let next: XcUnit;
    if (wanted.length === 1 && wanted[0]!.suffix === "") {
      const t = texts.get("")!;
      const mine = had?.variations?.device;
      next = mine
        ? {
            ...had,
            variations: {
              ...had!.variations,
              device: sorted({ ...mine, other: unitOf(t, mine.other, source) }),
            },
          }
        : unitOf(t, had, source);
    } else {
      const kind = wanted[0]!.suffix.startsWith(" [width:")
        ? "width"
        : "device";
      const mine = variants(had);
      const all = wanted.map(
        (r) => texts.get(r.suffix) ?? translations[key + r.suffix],
      );
      const one = all.every((t) => t !== undefined && t === all[0]);
      if (!mine && had && one) next = unitOf(all[0]!, had, source);
      else {
        const variantOf = (suffix: string) => /:(.*)\]$/.exec(suffix)![1]!;
        // A plain unit becoming variants keeps its text on each.
        const out: Record<string, XcUnit> = mine
          ? { ...mine }
          : had
            ? Object.fromEntries(wanted.map((r) => [variantOf(r.suffix), had]))
            : {};
        for (const read of wanted) {
          const t = texts.get(read.suffix);
          if (t === undefined) continue;
          const name = variantOf(read.suffix);
          out[name] = unitOf(t, out[name], variants(source)?.[name]);
        }
        next = {
          ...(had && mine ? had : {}),
          variations: { [kind]: sorted(out) },
        };
      }
    }
    localizations[language] = next;
    const others = Object.keys(localizations).filter((k) => k !== language);
    const wasSorted = others.every((k, i) => i === 0 || others[i - 1]! <= k);
    if (wasSorted) entry.localizations = sorted(localizations);
  }
  if (!changed) return text;
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const newline = text.endsWith("\n") ? "\n" : "";
  const body = text.slice(bom.length);
  if (serializeXcstrings(JSON.parse(body)) + newline !== body)
    throw new Error(
      "the catalogue is not in Xcode's layout, so a write would move bytes it does not change; save it from Xcode first",
    );
  return bom + serializeXcstrings(catalog) + newline;
}
