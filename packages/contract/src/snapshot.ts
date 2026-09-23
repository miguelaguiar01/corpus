// Normative corpus/1 envelope and entity schemas (§4, §6, §8). Loose
// objects throughout: consumers must ignore unknown fields (§4).
import { z } from "zod";
import {
  fieldDeclarationSchema,
  stringEntrySchema,
  identifier,
  languageCode,
  entityId,
  librarySchema,
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
  adapter: z.enum(["messages", "table"]),
  type: identifier(),
  // The library a new string in this file is written for (§5, §11);
  // `syntax` is the old name, sent beside it until 1.0.
  library: librarySchema.optional(),
  syntax: librarySchema.optional(),
});

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
  // Per target language (§5); the repository's, replaced whole by a push
  // that carries it.
  glossary: glossarySchema.optional(),
  seedTranslations: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional(),
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
