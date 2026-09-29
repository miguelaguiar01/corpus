// Apple's String Catalog, `.xcstrings` (#727): one JSON file holding
// every language. A key is a string; `localizations.<lang>` is that
// language's unit, a `stringUnit`, `variations` by plural category,
// device or width, or a `stringUnit` whose `%#@name@` substitutions are
// plurals of their own.
import type { StringEntry } from "@corpus/contract";
import { parseTree } from "jsonc-parser";
import { pluralText } from "./messages";
import { ownRecord } from "./text";

type StringUnit = { state?: string; value?: string };

type XcUnit = {
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

type XcEntry = {
  comment?: string;
  extractionState?: string;
  shouldTranslate?: boolean;
  localizations?: Record<string, XcUnit>;
};

type XcCatalog = {
  sourceLanguage: string;
  version?: string;
  // A Map, in the file's order: an object would move integer-like keys
  // ("1", "10") ahead of the rest (#853).
  strings: Map<string, XcEntry>;
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
  const strings = data.strings as unknown as Record<string, XcEntry>;
  const keys = !Object.keys(strings).some(isIndex)
    ? undefined
    : parseTree(text.replace(/^\uFEFF/, ""))
        ?.children?.filter((p) => p.children?.[0]?.value === "strings")
        .at(-1)
        ?.children?.[1]?.children?.map((p) => p.children![0]!.value as string);
  return {
    ...(data as XcCatalog),
    strings: new Map(
      (keys ?? Object.keys(strings)).map((k) => [k, strings[k]!]),
    ),
  };
}

// A text and whether every unit in it is translated, for one variant.
type Read = { suffix: string; text: string; done: boolean };

const done = (unit: StringUnit | undefined) => unit?.state === "translated";

function pluralRead(arg: string, forms: Record<string, XcUnit>): Read {
  return {
    suffix: "",
    text: pluralText(
      arg,
      Object.fromEntries(
        Object.entries(forms).map(([c, unit]) => [
          c,
          unit.stringUnit?.value ?? "",
        ]),
      ),
    ),
    done: Object.values(forms).every((unit) => done(unit.stringUnit)),
  };
}

// printf's verbs, `%%` a literal and `%#@name@` a substitution, each
// taking the next argument unless it names its own with `%n$`.
const VERB =
  /%(?:(\d+)\$)?(?:#@([^@\s]+)@|[-+0# ]*\d*(?:\.\d+)?(?:hh|h|ll|l|z|j|t|q|L)?[a-zA-Z@])|%%/g;

// Each verb of a printf text with the argument position it takes, its
// own `%n$` or the one after the verb before it, counting from `start`;
// `%%` is text.
function* verbs(
  text: string,
  start = 1,
): Generator<{ position: number; sub?: string; verb: string }> {
  let next = start;
  for (const m of text.matchAll(VERB)) {
    if (m[0] === "%%") continue;
    const position = m[1] ? Number(m[1]) : next;
    next = position + 1;
    yield { position, verb: m[0], ...(m[2] && { sub: m[2] }) };
  }
}

// Each substitution a unit's text names, `%#@name@`, with the argument
// it formats: its `argNum`, or the position its verb stands at.
function* substitutionArgs(
  value: string,
  subs: NonNullable<XcUnit["substitutions"]>,
): Generator<[string, number]> {
  for (const { position, sub } of verbs(value))
    if (sub) yield [sub, subs[sub]?.argNum ?? position];
}

// A substitution's name is the unit's own (`arg1` in English,
// `count_posts` in Polish, for one argument), so its plural is named by
// the argument it formats, `argN`: its `argNum`, or the position its
// `%#@name@` takes among the verbs.
function substituted(unit: XcUnit): Read {
  const value = unit.stringUnit?.value ?? "";
  const subs = unit.substitutions ?? {};
  const argOf = new Map<string, number>();
  for (const [name, arg] of substitutionArgs(value, subs))
    if (!argOf.has(name)) argOf.set(name, arg);
  let complete = done(unit.stringUnit);
  const text = value.replace(
    /%(?:\d+\$)?#@([^@\s]+)@/g,
    (whole, name: string) => {
      const plural = subs[name]?.variations?.plural;
      if (!plural) return whole;
      const read = pluralRead(`arg${argOf.get(name) ?? 1}`, plural);
      complete &&= read.done;
      return read.text;
    },
  );
  return { suffix: "", text, done: complete };
}

// A unit's texts: one, or one per device or width variant, each named
// by a suffix on the key, `settings.platform [device:iphone]`.
function unitTexts(unit: XcUnit): Read[] {
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
  if (variations.plural) return [pluralRead("count", variations.plural)];
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
  return [...catalog.strings].filter(
    ([key, entry]) =>
      key !== "" &&
      entry.extractionState !== "stale" &&
      entry.shouldTranslate !== false,
  );
}

// The verbs a key carries, by position: SwiftUI's `Text("… \(n)")`
// writes each interpolation into the key as the verb the code passes.
function keyArguments(key: string): string[] | undefined {
  const out: string[] = [];
  // A substitution in the key takes its position, its type the value's.
  for (const { position, sub, verb } of verbs(key))
    if (!sub) out[position - 1] ??= verb.replace(/^%\d+\$/, "%");
  return out.length > 0 ? Array.from(out, (w) => w ?? "") : undefined;
}

// A key's source texts. A key with no unit in the source language, or
// an empty one, is its own text, as Xcode reads it (`Text("Bookmarks")`).
function sourceReads(
  catalog: XcCatalog,
  key: string,
): (Read & { keyIsText?: true })[] {
  const unit =
    catalog.strings.get(key)?.localizations?.[catalog.sourceLanguage];
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
    const passed = keyArguments(key);
    return sourceReads(catalog, key).map((read) => ({
      id: key + read.suffix,
      type: options.type,
      source: read.text,
      ...(read.keyIsText && { keyIsText: true }),
      ...(passed && !read.keyIsText && { arguments: passed }),
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
  for (const entry of catalog.strings.values())
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
  const entries =
    value instanceof Map
      ? [...(value as Map<string, unknown>)]
      : Object.entries(value);
  if (entries.length === 0) return `{\n\n${indent}}`;
  return `{\n${entries
    .map(
      ([k, v]) =>
        `${inner}${JSON.stringify(k)} : ${serializeXcstrings(v, inner)}`,
    )
    .join(",\n")}\n${indent}}`;
}

// A substitution by name, the unit's own only (#845).
function substitutionNamed<T>(
  record: Record<string, T> | undefined,
  key: string,
) {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

// A key an object puts ahead of the rest, whatever order it came in.
const isIndex = (key: string) => /^(?:0|[1-9]\d*)$/.test(key);

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
  for (const [name, arg] of substitutionArgs(value, unit.substitutions))
    out.set(`arg${arg}`, name);
  return out;
}

// Whether a text can be a unit: a plural Xcode has no key for (`=0`),
// one that opens but does not parse, a plural on count with text beside
// it (a substitution needs its argument), or one argument pluralised
// twice, cannot.
export function xcstringsWritable(text: string): boolean {
  const parts = partsOf(text);
  if (
    parts.length === 1 &&
    typeof parts[0] === "string" &&
    /\{\s*(?:count|arg\d+)\s*,\s*plural\s*,/.test(text)
  )
    return false;
  const plurals = parts.filter((p) => typeof p !== "string");
  const args = plurals.map((p) => p.arg);
  if (parts.length > 1 && args.includes("count")) return false;
  if (new Set(args).size !== args.length) return false;
  return plurals.every((p) =>
    Object.keys(p.branches).every((k) => !k.startsWith("=")),
  );
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
  // Where each plural's token sits among the verbs: a token away from
  // its argument's position names it with `argNum`, or Xcode would bind
  // it to the position and swap the numbers.
  const positionOf = new Map<string, number>();
  let next = 1;
  for (const part of parts) {
    if (typeof part !== "string") {
      if (!positionOf.has(part.arg)) positionOf.set(part.arg, next);
      next += 1;
      continue;
    }
    for (const { position } of verbs(part, next)) next = position + 1;
  }
  const substitutions: NonNullable<XcUnit["substitutions"]> = {};
  for (const plural of plurals) {
    const name = nameOf(plural.arg);
    const before =
      substitutionNamed(like?.substitutions, name) ??
      substitutionNamed(source?.substitutions, theirs.get(plural.arg) ?? name);
    const n = Number(plural.arg.slice(3));
    substitutions[name] = {
      ...((before?.argNum !== undefined ||
        positionOf.get(plural.arg) !== n) && {
        argNum: n,
      }),
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

function variantsOf(unit: XcUnit | undefined) {
  return unit?.variations?.device ?? unit?.variations?.width;
}

// A unit whose texts are device or width variants, written back: each
// changed variant in its own unit, or the one text where every variant
// reads the same and the file held a plain unit. `changed` holds the
// texts to write, `held` every variant's text as the server holds it.
function variantUnit(
  had: XcUnit | undefined,
  source: XcUnit | undefined,
  wanted: Read[],
  changed: Map<string, string>,
  held: (suffix: string) => string | undefined,
): XcUnit {
  const kind = wanted[0]!.suffix.startsWith(" [width:") ? "width" : "device";
  const mine = variantsOf(had);
  const all = wanted.map((r) => changed.get(r.suffix) ?? held(r.suffix));
  const one = all.every((t) => t !== undefined && t === all[0]);
  if (!mine && had && one) return unitOf(all[0]!, had, source);
  const variantOf = (suffix: string) => /:(.*)\]$/.exec(suffix)![1]!;
  // A plain unit becoming variants keeps its text on each.
  const out: Record<string, XcUnit> = mine
    ? { ...mine }
    : had
      ? Object.fromEntries(wanted.map((r) => [variantOf(r.suffix), had]))
      : {};
  for (const read of wanted) {
    const t = changed.get(read.suffix);
    if (t === undefined) continue;
    const name = variantOf(read.suffix);
    out[name] = unitOf(t, out[name], variantsOf(source)?.[name]);
  }
  return { ...(had && mine ? had : {}), variations: { [kind]: sorted(out) } };
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
  onRefused?: (id: string, text: string) => void,
): string {
  translations = ownRecord(translations);
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
      if (t === undefined || t === "" || current.get(key + read.suffix) === t)
        continue;
      if (!xcstringsWritable(t)) onRefused?.(key + read.suffix, t);
      else texts.set(read.suffix, t);
    }
    if (texts.size === 0) continue;
    changed = true;
    const source = entry.localizations?.[catalog.sourceLanguage];
    const localizations = (entry.localizations ??= {});
    const had = localizations[language];
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
    } else
      next = variantUnit(
        had,
        source,
        wanted,
        texts,
        (suffix) => translations[key + suffix],
      );
    localizations[language] = next;
    const others = Object.keys(localizations).filter((k) => k !== language);
    const wasSorted = others.every((k, i) => i === 0 || others[i - 1]! <= k);
    if (wasSorted) entry.localizations = sorted(localizations);
  }
  if (!changed) return text;
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const newline = text.endsWith("\n") ? "\n" : "";
  const body = text.slice(bom.length);
  if (serializeXcstrings(parseXcstrings(body)) + newline !== body)
    throw new Error(
      "the catalogue is not in Xcode's layout, so a write would move bytes it does not change; save it from Xcode first",
    );
  return bom + serializeXcstrings(catalog) + newline;
}
