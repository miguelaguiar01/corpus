// The project token's read and draft surface (§10): request bodies as
// schemas, responses as types, shared by the server and `corpus mcp`.
// Additive to corpus/1.
import { z } from "zod";
import { stringId } from "./strings";
import type { Example, Library } from "./strings";
import type { GlossaryEntry } from "./glossary";

export const QUEUE_KINDS = [
  "untranslated",
  "stale",
  "unverifiedSource",
  "agentDrafts",
] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

// An item carries its source and the row's current text (null when
// none), so a queue read is enough to translate a batch and the agent
// drafts queue reads back as a review list; additive.
export type QueueItemResponse = {
  key: string;
  language: string;
  type: string;
  source: string;
  text: string | null;
};
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
  // The text is the key (#611): a proposal is refused, the code holds it.
  keyIsText: boolean;
  archived: boolean;
  placeholders: string[];
  selects: string[];
  // The counts the source pluralises on (§5); additive, since a client
  // ignores fields it does not know (§4).
  plurals: string[];
  // The rich-text tags the source wraps text in (§5); additive.
  tags: string[];
  // The i18n library the source and its translations are written for
  // (§5): "icu", "i18next" for {{name}} interpolation, "vue" for pipe
  // plurals and {'…'} literals, or "printf" for %s and %[2]s verbs
  // named by position (#594). `syntax` is the field's old name,
  // sent beside it with the same value until 1.0, when it goes with the
  // config's alias (#522).
  library: Library;
  syntax: Library;
  // Every value the source takes, placeholders then counts, in source
  // order, with the type's declaration for the slot and the first
  // example's value per language (§5, §7); additive.
  slots: {
    name: string;
    description: string | null;
    role: string | null;
    // The format the source writes, "number, ::percent", or null (#555).
    format: string | null;
    // The placeholder as the source writes it when that is not its
    // name, printf's "%[2]s", or null (#594); additive.
    written: string | null;
    values: Record<string, string>;
  }[];
  examples: Example[];
  metadata: Record<string, unknown> | null;
  // The type's voice note (§5), or null.
  note: string | null;
  // What the repository says about this one string, an ARB's
  // @key.description (§4), or null; additive (#567).
  stringNote: string | null;
  // The glossary entries whose term occurs in the source (§5), per
  // target language.
  glossary: Record<string, GlossaryEntry[]>;
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
  // The entities the string's ref metadata points at (§6), as the
  // editor's cards show them; `field` is always set on a string's
  // response and optional only for the editor's entity browser.
  entities: {
    field?: string;
    entityId: string;
    type: string;
    typeLabel: string;
    name: string;
    attributes: Record<string, string> | null;
  }[];
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

// Strict: a field the route does not take is refused, not dropped, so
// a `state` on a draft is told why rather than ignored (§10).
export const draftBodySchema = z.strictObject({ text: z.string() });
export type DraftBody = z.infer<typeof draftBodySchema>;

export type DraftResponse = {
  key: string;
  language: string;
  state: "translated";
  text: string;
  actor: string;
  // What the saved plural still lacks, a category its language uses,
  // one message per branch; absent when nothing is (#556).
  incomplete?: string[];
};

export const stringProposalBodySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("edit"), text: z.string() }),
  z.strictObject({ kind: z.literal("delete") }),
]);
export type StringProposalBody = z.infer<typeof stringProposalBodySchema>;

export const newStringBodySchema = z.strictObject({
  key: stringId(),
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

// The project's pending proposals (§11) as the token sees them; `mine`
// marks the agent actor's own, the only ones it may withdraw.
export type ProposalListResponse = {
  proposals: (ProposalResponse & { createdAt: string; mine: boolean })[];
};

export type ApiError = { error: string; message: string };
