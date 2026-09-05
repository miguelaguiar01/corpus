import type {
  EntityTypeDeclaration,
  Example,
  FieldDeclaration,
} from "@corpus/contract";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { TranslationState } from "@/translations/state";

// Users per spec §10: a display name and one flag. The first user created
// on an instance becomes a maintainer (enforced in the auth layer, #15).
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  maintainer: integer("maintainer", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Long-lived sessions (§10). Only a hash of the session token is stored;
// the cookie carries the raw token.
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

// Projects, strings, entities, translations (§2, §8, §11). Source text and
// metadata are outputs of push (repo wins); translations/states are M2.
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  sourceLanguage: text("source_language").notNull(),
  languages: text("languages", { mode: "json" }).notNull().$type<string[]>(),
  // Per-type metadata field declarations (§5), refreshed on each push, so
  // the catalogue can generate facets generically.
  stringTypes: text("string_types", { mode: "json" }).$type<
    Record<string, Record<string, FieldDeclaration>>
  >(),
  // Entity type labels (§6), refreshed on each push, for entity cards.
  entityTypes: text("entity_types", { mode: "json" }).$type<
    Record<string, EntityTypeDeclaration>
  >(),
  tokenHash: text("token_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const strings = sqliteTable(
  "strings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    // The client's stable snapshot id (§4); unique within a project.
    stringId: text("string_id").notNull(),
    type: text("type").notNull(),
    source: text("source").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    examples: text("examples", { mode: "json" }).$type<Example[]>(),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("strings_project_string_id").on(t.projectId, t.stringId)],
);

export const entities = sqliteTable(
  "entities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    entityId: text("entity_id").notNull(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    attributes: text("attributes", { mode: "json" }).$type<
      Record<string, string>
    >(),
  },
  (t) => [
    uniqueIndex("entities_project_entity_id").on(t.projectId, t.entityId),
  ],
);

// The column enum mirrors the pure machine's type (§11); `satisfies`
// keeps the two from drifting.
export const TRANSLATION_STATES = [
  "untranslated",
  "translated",
  "verified",
] as const satisfies readonly TranslationState[];

// Per string × language row (§11): text, state, stale overlay. The state
// machine transitions land in M2; this ticket is the row shape only.
export const stringTranslations = sqliteTable(
  "string_translations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    stringId: integer("string_id")
      .notNull()
      .references(() => strings.id),
    language: text("language").notNull(),
    text: text("text"),
    state: text("state", { enum: TRANSLATION_STATES })
      .notNull()
      .default("untranslated"),
    stale: integer("stale", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("translations_string_language").on(t.stringId, t.language),
    index("translations_state").on(t.state),
  ],
);

// Append-only edits log (§11): who, when, string, language, old → new
// text/state. Written only by the transition service, never updated.
export const edits = sqliteTable(
  "edits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    stringId: integer("string_id")
      .notNull()
      .references(() => strings.id),
    language: text("language").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    at: integer("at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    oldText: text("old_text"),
    newText: text("new_text"),
    oldState: text("old_state", { enum: TRANSLATION_STATES }).notNull(),
    newState: text("new_state", { enum: TRANSLATION_STATES }).notNull(),
  },
  (t) => [index("edits_string_language").on(t.stringId, t.language)],
);

// Snapshot history (§9.5): one row per applied push (dry runs excluded)
// with the report the CLI printed, so a maintainer can see when the
// repo last pushed and what it changed.
export const pushes = sqliteTable(
  "pushes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    at: integer("at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    stringCount: integer("string_count").notNull(),
    added: integer("added").notNull(),
    changed: integer("changed").notNull(),
    stale: integer("stale").notNull(),
    archived: integer("archived").notNull(),
    unarchived: integer("unarchived").notNull(),
    seeded: integer("seeded").notNull(),
  },
  (t) => [index("pushes_project_at").on(t.projectId, t.at)],
);
