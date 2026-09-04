// Normative corpus/1 envelope and entity schemas (§4, §6, §8). Loose
// objects throughout: consumers must ignore unknown fields (§4).
import { z } from "zod";
import { fieldDeclarationSchema, stringEntrySchema } from "./strings";

export const CONTRACT_VERSION = "corpus/1" as const;

export const entitySchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  attributes: z.record(z.string(), z.string()).optional(),
});

export const entityTypeDeclarationSchema = z.looseObject({
  label: z.string().min(1),
});

// stringTypes/entityTypes travel in the snapshot so the server can
// render metadata generically (§5) without reading the client's config.
export const snapshotSchema = z.looseObject({
  contract: z.literal(CONTRACT_VERSION),
  project: z.string().min(1),
  sourceLanguage: z.string().min(1),
  strings: z.array(stringEntrySchema),
  entities: z.array(entitySchema).default([]),
  stringTypes: z
    .record(z.string(), z.record(z.string(), fieldDeclarationSchema))
    .optional(),
  entityTypes: z.record(z.string(), entityTypeDeclarationSchema).optional(),
  seedTranslations: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional(),
});

export type Entity = z.infer<typeof entitySchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
