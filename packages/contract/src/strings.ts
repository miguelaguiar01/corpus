// Normative corpus/1 schemas for string entries (§4, §5, §7). All object
// schemas are loose: consumers must ignore unknown fields (§4).
import { z } from "zod";

export const metadataValueSchema = z.union([
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
export const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
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
export const STRING_ID_RE = /^(?:[^\p{Cc}]|[\t\n\r])+$/u;
export const MAX_STRING_ID_LENGTH = 1000;
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
    .regex(LANGUAGE_RE, "a language tag such as en, pt-PT or en_US");
// The i18n library a source is written for (§3, §5). One value carries
// how placeholders are spelled, how plurals are written and what is
// escaped: `icu` is plain ICU MessageFormat, as next-intl, FormatJS and
// Lingui write it; `i18next` is its {{name}} interpolation, stored and
// written back as written.
export const LIBRARIES = ["icu", "i18next", "vue", "printf"] as const;
export type Library = (typeof LIBRARIES)[number];
export const librarySchema = z.enum(LIBRARIES);

// What a source, an entry or a declaration is written for: the library
// it names, the old `syntax` if that is all it has, plain ICU otherwise.
export function libraryOf(
  value: { library?: Library; syntax?: Library } | undefined,
): Library {
  return value?.library ?? value?.syntax ?? "icu";
}

/** @deprecated a source declares its `library`; goes at 1.0. */
export const SYNTAXES = LIBRARIES;
/** @deprecated use {@link Library}. */
export type Syntax = Library;
/** @deprecated use {@link librarySchema}. */
export const syntaxSchema = librarySchema;

// Entity ids carry their type: character:condessa-rosa (§6).
export const ENTITY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
export const entityId = () =>
  z
    .string()
    .min(1)
    .regex(
      ENTITY_ID_RE,
      "letters, digits, dot, underscore, hyphen and colon only",
    );

// Slot values in the source language, plus, per target language, the
// same slots resolved for that language by the client (§7); Corpus
// derives nothing.
export const exampleSchema = z.looseObject({
  values: z.record(z.string(), z.string()),
  rendered: z.string(),
  valuesByLanguage: z
    .record(languageCode(), z.record(z.string(), z.string()))
    .optional(),
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

export const placeholderSlotSchema = z.looseObject({
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
export type PlaceholderSlot = z.infer<typeof placeholderSlotSchema>;
