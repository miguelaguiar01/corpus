// The pull payload (§8): what `corpus pull` downloads. Per language, a
// map of string id → text for every non-archived row at or above the
// requested state that has text; `types` lets adapters route ids to the
// source that declared them. The source language rides along like any
// other, which is what makes the push∘pull round trip possible.
import { z } from "zod";
import { CONTRACT_VERSION } from "./snapshot";

export const MIN_STATES = ["untranslated", "translated", "verified"] as const;
export type MinState = (typeof MIN_STATES)[number];

export const pullPayloadSchema = z.looseObject({
  contract: z.literal(CONTRACT_VERSION),
  project: z.string().min(1),
  sourceLanguage: z.string().min(1),
  minState: z.enum(MIN_STATES),
  types: z.record(z.string(), z.string()),
  translations: z.record(z.string(), z.record(z.string(), z.string())),
});

export type PullPayload = z.infer<typeof pullPayloadSchema>;
