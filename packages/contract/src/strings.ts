// Snapshot string entries and metadata field declarations (spec §5, §7).
// This zod schema is the normative definition of the contract (§4) —
// nothing outside this package redeclares these shapes.
import { z } from "zod";

// Metadata VALUES carried on an entry: enum/text/ref fields arrive as
// strings, flags as booleans, list<ref> as string arrays (§5).
export const metadataValueSchema = z.union([
  z.string(),
  z.boolean(),
  z.array(z.string()),
]);

// Concrete slot values plus the source-language render, produced by the
// client's exporter at push time (§7). Values are source-language values
// for v1 (§7, deferred per §13).
export const exampleSchema = z.looseObject({
  values: z.record(z.string(), z.string()),
  rendered: z.string(),
});

// Unknown fields pass through everywhere (§4 additive versioning): a
// corpus/1 consumer must ignore what it doesn't know.
export const stringEntrySchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  source: z.string(),
  metadata: z.record(z.string(), metadataValueSchema).optional(),
  examples: z.array(exampleSchema).optional(),
});

// The five metadata primitives (§5), declared per string type. Every
// field carries a human description — the UI renders it as the tooltip.
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
