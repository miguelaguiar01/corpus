// Normative corpus/1 schemas for string entries (§4, §5, §7). All object
// schemas are loose: consumers must ignore unknown fields (§4).
import { z } from "zod";

const metadataValueSchema = z.union([
  z.string(),
  z.boolean(),
  z.array(z.string()),
]);

// Identifiers travel into object keys, JSON paths and file names on both
// sides, so they are restricted to letters, digits, dot, underscore and
// hyphen; a language code is a BCP 47 tag (en, pt-PT, zh-Hant-TW), or
// the same with underscores as i18next and Crowdin write it (en_US),
// kept as written everywhere but where the runtime's locale data is
// asked.
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const LANGUAGE_RE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/;

// The BCP 47 form of a code for `Intl`, which refuses an underscore.
export function localeOf(code: string): string {
  return code.replace(/_/g, "-");
}
export const identifier = () =>
  z
    .string()
    .min(1)
    .regex(IDENTIFIER_RE, "letters, digits, dot, underscore and hyphen only");
// A string id is any text without control characters, a line break
// or a tab aside: a dotted identifier, or, as i18next's natural keys,
// the sentence itself, which may run over lines. It travels in URLs
// and tool arguments, which encode; only its length is bounded.
const STRING_ID_RE = /^(?:[^\p{Cc}]|[\t\n\r])+$/u;
const MAX_STRING_ID_LENGTH = 1000;
export const stringId = () =>
  z
    .string()
    .min(1)
    .max(MAX_STRING_ID_LENGTH)
    .regex(STRING_ID_RE, "text without control characters");
export const languageCode = () =>
  z
    .string()
    .min(1)
    .regex(LANGUAGE_RE, {
      error: (issue) => notALanguageTag(String(issue.input)),
    });

// POSIX writes a script as a modifier (`sr@latin`, qBittorrent's files);
// BCP 47 writes it as a subtag.
const POSIX_SCRIPTS: Record<string, string> = {
  latin: "Latn",
  latn: "Latn",
  cyrillic: "Cyrl",
  cyrl: "Cyrl",
  arabic: "Arab",
  devanagari: "Deva",
};

// The tag a POSIX code with a script modifier names (`sr@latin` is
// sr-Latn, `sr_RS@latin` sr-Latn-RS), or undefined for any other code,
// a modifier that is no script (`ca@valencia`) among them.
export function posixTag(code: string): string | undefined {
  const posix = /^([A-Za-z]{2,3})(?:[-_]([A-Za-z]{2}))?@([A-Za-z]+)$/.exec(
    code,
  );
  const script = posix && POSIX_SCRIPTS[posix[3]!.toLowerCase()];
  return posix && script
    ? [posix[1]!.toLowerCase(), script, posix[2]?.toUpperCase()]
        .filter(Boolean)
        .join("-")
    : undefined;
}

// Why a code is not a tag, naming it (#657), and for a POSIX code the
// tag to write and the mapping that keeps its files' names.
function notALanguageTag(code: string): string {
  const tag = posixTag(code);
  if (tag) {
    return `${JSON.stringify(code)} is not a language tag; write ${tag}, and map its files with languageFiles: { ${JSON.stringify(tag)}: ${JSON.stringify(code)} } on the source`;
  }
  return `${JSON.stringify(code)} is not a language tag such as en, pt-PT or en_US`;
}
// The i18n library a source is written for (§3, §5). One value carries
// how placeholders are spelled, how plurals are written and what is
// escaped: `icu` is plain ICU MessageFormat, as next-intl, FormatJS and
// Lingui write it; `i18next` is its {{name}} interpolation, stored and
// written back as written.
export const LIBRARIES = [
  "icu",
  "i18next",
  "vue",
  "printf",
  "chrome",
  "android",
  "counterpart",
  "easy_localization",
  "rails",
  "qt",
] as const;
export type Library = (typeof LIBRARIES)[number];
export const librarySchema = z.enum(LIBRARIES);

// CLDR's plural categories, in its order.
export const PLURAL_CATEGORIES = [
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

// A plural's exact branch, as the runtimes match it: `=01` is not `=1`.
export const EXACT_KEY = /^=(?:0|[1-9]\d*)$/;

// Categories CLDR has dropped from a language, which a file written to an
// older CLDR still gives a form of its own, on the integers: Hebrew's
// many (20, 30, …) before CLDR 42 (#982).
export const REMOVED_PLURAL_CATEGORIES: Record<
  string,
  Partial<Record<PluralCategory, (n: number) => boolean>>
> = {
  he: { many: (n) => n > 10 && n % 10 === 0 },
  iw: { many: (n) => n > 10 && n % 10 === 0 },
};

const LIBRARY_NAMES: Record<Library, string> = {
  icu: "ICU",
  i18next: "i18next",
  vue: "vue-i18n",
  printf: "printf",
  chrome: "Chrome i18n",
  android: "Android",
  counterpart: "counterpart",
  easy_localization: "easy_localization",
  rails: "Rails I18n",
  qt: "Qt",
};

export function libraryName(library: Library): string {
  return LIBRARY_NAMES[library];
}

// What a text that does not parse is called in a message (#644):
// "invalid ICU", "invalid vue-i18n message".
export function messageKind(library: Library): string {
  return library === "icu" ? "ICU" : `${libraryName(library)} message`;
}

// A string type whose text an HTML renderer reads (#622): its tags are
// markup, so a translation's need not match the source's.
export const richTextSchema = z.enum(["html"]);
export type RichText = z.infer<typeof richTextSchema>;

// What a source, an entry or a declaration is written for: the library
// it names, the old `syntax` if that is all it has, plain ICU otherwise.
export function libraryOf(
  value: { library?: Library; syntax?: Library } | undefined,
): Library {
  return value?.library ?? value?.syntax ?? "icu";
}

// Entity ids carry their type: character:condessa-rosa (§6).
const ENTITY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
export const entityId = () =>
  z
    .string()
    .min(1)
    .regex(
      ENTITY_ID_RE,
      "letters, digits, dot, underscore, hyphen and colon only",
    );

// A record keyed by data, a placeholder's name (#878): zod builds a
// record by assignment and so drops a `__proto__` key, which is a name
// like any other. The record's own checks stand; a record that has one
// is rebuilt as a null-prototype object holding every own key, in the
// input's order.
function dataRecord<V extends z.ZodType>(value: V) {
  const record = z.record(z.string(), value);
  return z.unknown().transform((input, ctx) => {
    const parsed = record.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue(issue as never);
      return z.NEVER;
    }
    const read = input as Record<string, unknown>;
    if (!Object.hasOwn(read, "__proto__")) return parsed.data;
    const out = Object.create(null) as Record<string, z.output<V>>;
    for (const key of Object.keys(read)) {
      if (key !== "__proto__") {
        out[key] = parsed.data[key]!;
        continue;
      }
      const proto = value.safeParse(read[key]);
      if (!proto.success) {
        for (const issue of proto.error.issues)
          ctx.addIssue({ ...issue, path: [key, ...issue.path] } as never);
        return z.NEVER;
      }
      Object.defineProperty(out, key, {
        value: proto.data,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  });
}

// Slot values in the source language, plus, per target language, the
// same slots resolved for that language by the client (§7); Corpus
// derives nothing.
export const exampleSchema = z.looseObject({
  values: dataRecord(z.string()),
  rendered: z.string(),
  valuesByLanguage: z.record(languageCode(), dataRecord(z.string())).optional(),
});

export const stringEntrySchema = z.looseObject({
  id: stringId(),
  type: identifier(),
  source: z.string(),
  metadata: z.record(z.string(), metadataValueSchema).optional(),
  examples: z.array(exampleSchema).optional(),
  // The repository path the entry was read from (§4): what lets a
  // proposal be written back to the right file. Exec entries have none.
  file: z.string().min(1).optional(),
  // The text is the entry's key, read from an empty value under a
  // sentence key (§3, #589): it lives in the code that calls t(), so a
  // proposal on it is refused by that name (#611). Additive.
  keyIsText: z.boolean().optional(),
  // The printf verbs the code passes, by position, where the key carries
  // them and the text need not print them all (a String Catalog's
  // `notifications.favorite %lld` reading "starred", #731): values a
  // translation may pluralise on or print, of their type. Additive.
  arguments: z.array(z.string()).optional(),
  // Per target language, the plural categories a gettext target file's
  // `Plural-Forms` picks, where they are not the language's CLDR ones
  // (#951): Italian's one and other under `nplurals=2`; and a file's own
  // `=N` keys, where no category reads a form (#982). Additive.
  pluralForms: z
    .record(
      z.string(),
      z
        .array(
          z.union([z.enum(PLURAL_CATEGORIES), z.string().regex(EXACT_KEY)]),
        )
        .min(1),
    )
    .optional(),
  // What the repository says about this one string, for a translator:
  // an ARB's @key.description (§4, #567). Never written back.
  note: z.string().min(1).optional(),
  // The library the text is written for (§5); plain ICU when absent.
  // `syntax` is the old name, sent beside it until 1.0 so an older
  // server reads a newer CLI's push correctly (§4).
  library: librarySchema.optional(),
  syntax: librarySchema.optional(),
});

// description is mandatory on every declaration — it renders as the
// field's tooltip (§5).
const declarationBase = { description: z.string().min(1) };

const placeholderSlotSchema = z.looseObject({
  description: z.string().min(1),
  role: z.string().optional(),
});

export const fieldDeclarationSchema = z.discriminatedUnion("type", [
  z.looseObject({
    type: z.literal("enum"),
    ...declarationBase,
    values: z.array(z.string().min(1)).min(1),
  }),
  z.looseObject({ type: z.literal("flag"), ...declarationBase }),
  z.looseObject({ type: z.literal("text"), ...declarationBase }),
  z.looseObject({
    type: z.literal("placeholders"),
    ...declarationBase,
    slots: z.record(z.string().min(1), placeholderSlotSchema),
  }),
  z.looseObject({
    type: z.literal("ref"),
    ...declarationBase,
    entityType: z.string().optional(),
  }),
  z.looseObject({
    type: z.literal("list<ref>"),
    ...declarationBase,
    entityType: z.string().optional(),
  }),
]);

export type MetadataValue = z.infer<typeof metadataValueSchema>;
export type Example = z.infer<typeof exampleSchema>;
export type StringEntry = z.infer<typeof stringEntrySchema>;
export type FieldDeclaration = z.infer<typeof fieldDeclarationSchema>;
