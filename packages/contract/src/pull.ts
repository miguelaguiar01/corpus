// The pull payload (§8): what `corpus pull` downloads. Per language, a
// map of string id → text for every non-archived row at or above the
// requested state that has text; `types` lets adapters route ids to the
// source that declared them. The source language rides along like any
// other, which is what makes the push∘pull round trip possible.
import { z } from "zod";
import { CONTRACT_VERSION } from "./snapshot";
import { identifier } from "./strings";

export const MIN_STATES = ["untranslated", "translated", "verified"] as const;
export type MinState = (typeof MIN_STATES)[number];

export const SOURCE_CHANGE_KINDS = ["edit", "add", "delete"] as const;
export type SourceChangeKind = (typeof SOURCE_CHANGE_KINDS)[number];

// A pending proposal (§11) for pull to write into a source file (§8):
// `text` for an edit or an add, none for a delete.
export const sourceChangeSchema = z
  .looseObject({
    kind: z.enum(SOURCE_CHANGE_KINDS),
    id: identifier(),
    type: identifier(),
    file: z.string().min(1),
    text: z.string().optional(),
  })
  .refine((c) => c.kind === "delete" || c.text !== undefined, {
    message: "an edit or an add carries text",
    path: ["text"],
  });

export const pullPayloadSchema = z.looseObject({
  contract: z.literal(CONTRACT_VERSION),
  project: z.string().min(1),
  sourceLanguage: z.string().min(1),
  minState: z.enum(MIN_STATES),
  types: z.record(z.string(), z.string()),
  translations: z.record(z.string(), z.record(z.string(), z.string())),
  sourceChanges: z.array(sourceChangeSchema).optional(),
});

export type SourceChange = z.infer<typeof sourceChangeSchema>;

export type PullPayload = z.infer<typeof pullPayloadSchema>;
