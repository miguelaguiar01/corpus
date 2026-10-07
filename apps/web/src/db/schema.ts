import type {
  WritableSource,
  EntityTypeDeclaration,
  Example,
  FieldDeclaration,
  Glossary,
  Library,
  RichText,
} from "@corpus/contract";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { TranslationState } from "@/translations/state";

// Users per spec §10: a display name and one flag. The first person to
// join becomes a maintainer (enforced in the auth layer, #15); a
// project's agent actor is a row here too and is never one.
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  // scrypt hash (auth/password.ts); null until the account has set one,
  // which an account created before passwords existed does at its next
  // sign-in with the invite secret.
  passwordHash: text("password_hash"),
  // Set by a maintainer's reset: the next sign-in must choose a new one.
  passwordTemporary: integer("password_temporary", { mode: "boolean" })
    .notNull()
    .default(false),
  maintainer: integer("maintainer", { mode: "boolean" })
    .notNull()
    .default(false),
  // A project's agent actor (§10): writes through the project token are
  // attributed to it; it never signs in and is never a maintainer.
  agent: integer("agent", { mode: "boolean" }).notNull().default(false),
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
  // Voice and register per string type (§5), refreshed by a push that
  // carries them; a push from an older CLI leaves them.
  typeNotes: text("type_notes", { mode: "json" }).$type<
    Record<string, string>
  >(),
  richText: text("rich_text", { mode: "json" }).$type<
    Record<string, RichText>
  >(),
  // The glossary per target language (§5), refreshed by a push that
  // carries it; a push from an older CLI leaves it.
  glossary: text("glossary", { mode: "json" }).$type<Glossary>(),
  // The writable file sources push declared (§4), where a new string
  // may go (§11).
  sources: text("sources", { mode: "json" }).$type<WritableSource[]>(),
  // Per target language, the digest of the seeds the last push carried
  // for it (#601), so the next push can leave that language's seeds
  // out; a push from a CLI that sends none leaves them.
  seedDigests: text("seed_digests", { mode: "json" }).$type<
    Record<string, string>
  >(),
  // Target languages that are variants of the source (#658): identical
  // seeds are translated there, and untranslated rows are no work.
  sourceVariants: text("source_variants", { mode: "json" }).$type<string[]>(),
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
    // The repository file the entry was read from (§4); null for exec.
    file: text("file"),
    // The text is the key, held by the code that calls t() (§4, #611).
    keyIsText: integer("key_is_text", { mode: "boolean" })
      .notNull()
      .default(false),
    // The printf verbs the code passes, by position, where the key
    // carries them (a String Catalog's, #731); null elsewhere.
    arguments: text("arguments", { mode: "json" }).$type<string[]>(),
    // Per target language, the plural categories a gettext target file
    // picks where they are not CLDR's (#951); null elsewhere.
    pluralForms: text("plural_forms", { mode: "json" }).$type<
      Record<string, string[]>
    >(),
    // Per target language, the exact keys one form of a gettext target
    // file is read by (#1060); null elsewhere.
    pluralShared: text("plural_shared", { mode: "json" }).$type<
      Record<string, string[][]>
    >(),
    // The file holds the plural as its forms: no =N branch, each form
    // splitting back (#704).
    pluralAsForms: integer("plural_as_forms", { mode: "boolean" })
      .notNull()
      .default(false),
    // The runtime's own plural rule where the source names one: "default",
    // vue-i18n's, whose forms are read by count (#1018), or "cldr",
    // easy_localization's CLDR picking (#961); null else.
    pluralRules: text("plural_rules").$type<"default" | "cldr">(),
    // The placeholder syntaxes the source layers on its library (#1049),
    // `["i18next"]` on a Chrome catalogue; null where none.
    placeholders: text("placeholders", { mode: "json" }).$type<Library[]>(),
    // The file an extractor generates the string's source into (#1000):
    // its text is the code's, so a proposal on it is refused.
    generated: text("generated"),
    // The languages the string takes, the source's among them, where its
    // source ships fewer than the project (#1006); null is every one.
    languages: text("languages", { mode: "json" }).$type<string[]>(),
    // What the repository says about this string (§4, #567).
    note: text("note"),
    // The message syntax the text is written in (§5); null is ICU.
    syntax: text("syntax").$type<Library>(),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("strings_project_string_id").on(t.projectId, t.stringId),
    // A project's strings in id order (the rowid ends the index): what a
    // queue step walks from its row, never another project's (#639).
    index("strings_project").on(t.projectId),
  ],
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
    // A text the repository seeded that fails validation (#646); a save
    // clears it, as does a push whose text passes.
    // Written inline, not bound per row: the batch of a first push is
    // sized to the variables it binds.
    invalid: integer("invalid", { mode: "boolean" })
      .notNull()
      .default(sql`false`),
    // What the repository offers a translator to start from, a gettext
    // fuzzy row (#721, #773): never the text, never counted; each push
    // replaces or clears it.
    suggestion: text("suggestion"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("translations_string_language").on(t.stringId, t.language),
    // The invalid rows only, few: status counts them and the queue
    // lists them without touching the rest (#646).
    index("translations_invalid")
      .on(t.language, t.stringId)
      .where(sql`${t.invalid} = 1`),
    // The rows holding a suggestion only, few or none: every push clears
    // them without walking the project's rows (#810).
    index("translations_suggestion")
      .on(t.stringId)
      .where(sql`${t.suggestion} is not null`),
    // Covers the progress counts, read in (language, state) order (#603).
    index("translations_language_state").on(
      t.language,
      t.state,
      t.stale,
      t.stringId,
    ),
  ],
);

// Append-only edits log (§11): who, when, string, language, old → new
// text/state. Written by the transition service, and by a push that
// carries a family's translations to its plural string with the last
// edit's author and time (#1063); never updated.
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

// Proposals (§11): pending source changes, beside the state machine.
export const sourceChanges = sqliteTable(
  "source_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind").notNull().$type<"edit" | "add" | "delete">(),
    // The string for an edit or a delete; none for an add.
    stringRowId: integer("string_row_id").references(() => strings.id),
    // The snapshot id for every kind: the key pull writes.
    key: text("key").notNull(),
    type: text("type").notNull(),
    // The source-language file pull writes.
    file: text("file").notNull(),
    text: text("text"),
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id),
    status: text("status")
      .notNull()
      .default("pending")
      .$type<"pending" | "applied" | "superseded" | "withdrawn">(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("source_changes_project_status").on(t.projectId, t.status),
    index("source_changes_string").on(t.stringRowId),
  ],
);
