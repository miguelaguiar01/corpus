// Normative corpus/1 envelope and entity schemas (§4, §6, §8). Loose
// objects throughout: consumers must ignore unknown fields (§4).
import { z } from "zod";
import {
  fieldDeclarationSchema,
  stringEntrySchema,
  identifier,
  languageCode,
  entityId,
  LIBRARIES,
  librarySchema,
  richTextSchema,
} from "./strings";
import { glossarySchema } from "./glossary";

export const CONTRACT_VERSION = "corpus/1" as const;

export const entitySchema = z.looseObject({
  id: entityId(),
  type: identifier(),
  name: z.string().min(1),
  attributes: z.record(z.string(), z.string()).optional(),
});

export const entityTypeDeclarationSchema = z.looseObject({
  label: z.string().min(1),
});

// The sources pull can rewrite in place (§4): where a new string may go.
export const writableSourceSchema = z.looseObject({
  path: z.string().min(1),
  adapter: z.enum(["messages", "table", "android", "fluent", "xliff", "yaml"]),
  type: identifier(),
  // The namespace a `{ns}` pattern captured for this file (#582): its
  // ids are `ns:key`, and a new string proposed into it takes the prefix.
  namespace: z.string().min(1).optional(),
  // The library a new string in this file is written for (§5, §11);
  // `syntax` is the old name, sent beside it until 1.0.
  library: librarySchema.optional(),
  syntax: librarySchema.optional(),
});

// The contract's closed values (#875): a server reports them on
// /api/health as `accepts`, so a push finds a server too old for what it
// sends before the whole snapshot is refused.
export type Accepts = {
  adapters: readonly string[];
  libraries: readonly string[];
  // Values a field takes beyond its first ones: `exact-plural-forms`,
  // an `=N` key in a string's `pluralForms` (#982).
  features?: readonly string[];
};

export const ACCEPTS: Accepts = {
  adapters: writableSourceSchema.shape.adapter.options,
  libraries: LIBRARIES,
  features: ["exact-plural-forms"],
};

// What every server since 0.20.0 accepts, which needs no asking; a server
// that reports no `accepts` is older than 0.21.0 and takes these alone.
export const BEFORE_ACCEPTS: Accepts = {
  adapters: ["messages", "table", "android", "fluent"],
  libraries: ["icu", "i18next", "vue", "printf", "chrome", "android"],
};

// stringTypes/entityTypes travel in the snapshot so the server can
// render metadata generically (§5) without reading the client's config.
export const snapshotSchema = z.looseObject({
  contract: z.literal(CONTRACT_VERSION),
  project: identifier(),
  sourceLanguage: languageCode(),
  strings: z.array(stringEntrySchema),
  entities: z.array(entitySchema).default([]),
  stringTypes: z
    .record(z.string(), z.record(z.string(), fieldDeclarationSchema))
    .optional(),
  entityTypes: z.record(z.string(), entityTypeDeclarationSchema).optional(),
  // Voice and register per string type (§5); the repository's, replaced
  // whole by a push that carries it.
  typeNotes: z.record(z.string(), z.string().min(1)).optional(),
  richText: z.record(z.string(), richTextSchema).optional(),
  // Per target language (§5); the repository's, replaced whole by a push
  // that carries it.
  glossary: glossarySchema.optional(),
  seedTranslations: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional(),
  // Per target language, the seeds the repository marks translated
  // though their text is the source's (#658): a loanword, `Status` in
  // German, an exporter says is done.
  seedTranslated: z.record(z.string(), z.array(z.string())).optional(),
  // Per target language, what the repository offers a translator to
  // start from and does not count as translated: a gettext fuzzy row,
  // msgmerge's guess (#721). Never a translation, never pulled back.
  seedSuggestions: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional(),
  // The target languages that are variants of the source, en-GB of en
  // (#658): a seed identical to the source is translated there, and an
  // untranslated row is not queued as work, the runtime falling back to
  // the source. Replaced whole by a push that carries it.
  sourceVariants: z.array(languageCode()).optional(),
  // Per target language, `seedDigest` of the seeds the repository holds
  // (#601): the server keeps the last push's, status returns them, and
  // a push leaves out the seeds of a language whose digest the server
  // already has. A language absent from `seedTranslations` still means
  // nothing to seed.
  seedDigests: z.record(z.string(), z.string()).optional(),
  // The writable file sources (§4, §8): where a new string may go.
  sources: z.array(writableSourceSchema).optional(),
});

export type WritableSource = z.infer<typeof writableSourceSchema>;
export type Entity = z.infer<typeof entitySchema>;
export type EntityTypeDeclaration = z.infer<typeof entityTypeDeclarationSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;

// The digest of one language's seeds, id to text, as the CLI and the
// server both compute it (#601): two FNV-1a runs over the sorted pairs,
// 64 bits between them, so a changed translation anywhere in a file
// changes it. Not a hash for integrity: a collision only costs a
// resend the server compares away.
export function seedDigest(texts: Record<string, string>): string {
  const ids = Object.keys(texts).sort();
  let a = 2166136261;
  let b = 0x9747b28c;
  for (const id of ids) {
    const chunk = `${id}\0${texts[id]}\n`;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      a = Math.imul(a ^ c, 16777619) >>> 0;
      b = Math.imul(b ^ c, 16777619) >>> 0;
    }
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
