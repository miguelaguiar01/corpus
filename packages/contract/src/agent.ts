// The project token's read and draft surface (§10): request bodies as
// schemas, responses as types, shared by the server and `corpus mcp`.
// Additive to corpus/1.
import { z } from "zod";
import { identifier } from "./strings";
import type { Example } from "./strings";

export const QUEUE_KINDS = [
  "untranslated",
  "stale",
  "unverifiedSource",
  "agentDrafts",
] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export type QueueItemResponse = { key: string; language: string; type: string };
export type QueuesResponse = {
  project: string;
  language: string | null;
  type: string | null;
  queues: Record<QueueKind, { count: number; items: QueueItemResponse[] }>;
};

export type TranslationState = "untranslated" | "translated" | "verified";

export type StringResponse = {
  key: string;
  type: string;
  source: string;
  sourceLanguage: string;
  file: string | null;
  archived: boolean;
  placeholders: string[];
  selects: string[];
  examples: Example[];
  metadata: Record<string, unknown> | null;
  translations: Record<
    string,
    {
      state: TranslationState;
      stale: boolean;
      text: string | null;
      agentDraft: boolean;
    }
  >;
  proposal: {
    id: number;
    kind: "edit" | "add" | "delete";
    text: string | null;
    author: string;
  } | null;
  // The ten nearest siblings (§9.3) and how many there are in all.
  siblings: {
    key: string;
    source: string;
    translations: Record<
      string,
      { state: TranslationState; stale: boolean; text: string | null }
    >;
  }[];
  siblingCount: number;
};

export const draftBodySchema = z.object({ text: z.string() });
export type DraftBody = z.infer<typeof draftBodySchema>;

export type DraftResponse = {
  key: string;
  language: string;
  state: "translated";
  text: string;
  actor: string;
};

export const stringProposalBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("edit"), text: z.string() }),
  z.object({ kind: z.literal("delete") }),
]);
export type StringProposalBody = z.infer<typeof stringProposalBodySchema>;

export const newStringBodySchema = z.object({
  key: identifier(),
  file: z.string().min(1),
  text: z.string(),
});
export type NewStringBody = z.infer<typeof newStringBodySchema>;

export type ProposalResponse = {
  id: number;
  kind: "edit" | "add" | "delete";
  key: string;
  file: string;
  text: string | null;
  status: "pending";
  author: string;
};

export type ApiError = { error: string; message: string };
