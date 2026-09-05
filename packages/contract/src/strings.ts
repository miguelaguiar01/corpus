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
// hyphen; a language code is a BCP 47 tag (en, pt-PT, zh-Hant-TW).
export const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const LANGUAGE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const identifier = () =>
  z
    .string()
    .min(1)
    .regex(IDENTIFIER_RE, "letters, digits, dot, underscore and hyphen only");
export const languageCode = () =>
  z.string().min(1).regex(LANGUAGE_RE, "a language tag such as en or pt-PT");
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

export const exampleSchema = z.looseObject({
  values: z.record(z.string(), z.string()),
  rendered: z.string(),
});

export const stringEntrySchema = z.looseObject({
  id: identifier(),
  type: identifier(),
  source: z.string(),
  metadata: z.record(z.string(), metadataValueSchema).optional(),
  examples: z.array(exampleSchema).optional(),
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
