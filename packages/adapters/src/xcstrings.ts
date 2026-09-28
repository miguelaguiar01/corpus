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
