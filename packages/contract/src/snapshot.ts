// Normative corpus/1 envelope and entity schemas (§4, §6, §8). Loose
// objects throughout: consumers must ignore unknown fields (§4).
import { z } from "zod";
import {
  fieldDeclarationSchema,
  stringEntrySchema,
  identifier,
  languageCode,
  entityId,
} from "./strings";

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

// stringTypes/entityTypes travel in the snapshot so the server can
// render metadata generically (§5) without reading the client's config.
export const writableSourceSchema = z.looseObject({
  path: z.string().min(1),
  adapter: z.enum(["messages", "table"]),
  type: identifier(),
});

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
  seedTranslations: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional(),
  // The writable file sources (§4, §8): where a new string may go.
  sources: z.array(writableSourceSchema).optional(),
});

export type WritableSource = z.infer<typeof writableSourceSchema>;
export type Entity = z.infer<typeof entitySchema>;
export type EntityTypeDeclaration = z.infer<typeof entityTypeDeclarationSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
