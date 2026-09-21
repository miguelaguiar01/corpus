// Everything the string surface needs for one string (§9.3), read-only:
// the string, its type's declarations, per-language rows, the entities
// its ref metadata points at, and the attributed edit history (§11).
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  glossaryMatches,
  type StringResponse,
  type Example,
  type FieldDeclaration,
  type GlossaryEntry,
  type MetadataValue,
  type Syntax,
} from "@corpus/contract";
import type { Db } from "@/db";
import {
  edits,
  entities,
  projects,
  strings,
  stringTranslations,
  users,
} from "@/db/schema";
import type { TranslationState } from "@/translations/state";
import { versionOf } from "@/translations/version";

export type StringDetail = {
  string: {
    id: number;
    key: string;
    type: string;
    source: string;
    archived: boolean;
    // The repository file it came from (§4); null when pull cannot write it.
    file: string | null;
    // The message syntax the text is written in (§5).
    syntax: Syntax;
    metadata: Record<string, MetadataValue> | null;
    examples: Example[] | null;
    // The type's voice note (§5), when the project carries one.
    note: string | null;
    // The glossary entries whose term occurs in the source (§5), per
    // target language.
    glossary: Record<string, GlossaryEntry[]>;
  };
  declarations: Record<string, FieldDeclaration>;
  translations: Record<
    string,
    {
      state: TranslationState;
      stale: boolean;
      text: string | null;
      version: number;
      // The latest edit was the agent actor's (§10): open to another
      // draft through the token, shown as an agent draft.
      agentDraft: boolean;
    }
  >;
  entities: EntityCard[];
  history: HistoryEntry[];
};

// The wire type is the source of truth (§10); the editor reuses it.
export type EntityCard = StringResponse["entities"][number];

export type HistoryEntry = {
  id: number;
  language: string;
  actor: string;
  agent: boolean;
  at: Date;
  oldText: string | null;
  newText: string | null;
  oldState: TranslationState;
  newState: TranslationState;
};

export function stringDetail(
  db: Db,
  projectId: number,
  key: string,
): StringDetail | undefined {
  const found = db
    .select({ string: strings, project: projects })
    .from(strings)
    .innerJoin(projects, eq(projects.id, strings.projectId))
    .where(and(eq(strings.projectId, projectId), eq(strings.stringId, key)))
    .get();
  if (!found) return undefined;
  const { string, project } = found;

  const declarations = project.stringTypes?.[string.type] ?? {};
  const metadata = (string.metadata ?? null) as Record<
    string,
    MetadataValue
  > | null;

  const history = db
    .select({
      id: edits.id,
      language: edits.language,
      actor: users.name,
      agent: users.agent,
      at: edits.at,
      oldText: edits.oldText,
      newText: edits.newText,
      oldState: edits.oldState,
      newState: edits.newState,
    })
    .from(edits)
    .innerJoin(users, eq(users.id, edits.userId))
    .where(eq(edits.stringId, string.id))
    .orderBy(desc(edits.id))
    .all();
  const latestByLanguage = new Map<string, HistoryEntry>();
  for (const entry of history) {
    if (!latestByLanguage.has(entry.language))
      latestByLanguage.set(entry.language, entry);
  }

  const translations: StringDetail["translations"] = {};
  for (const row of db
    .select()
    .from(stringTranslations)
    .where(eq(stringTranslations.stringId, string.id))
    .all()) {
    translations[row.language] = {
      state: row.state,
      stale: row.stale,
      text: row.text,
      version: versionOf(row),
      agentDraft: latestByLanguage.get(row.language)?.agent ?? false,
    };
  }

  return {
    string: {
      id: string.id,
      key: string.stringId,
      type: string.type,
      source: string.source,
      archived: string.archived,
      file: string.file,
      syntax: string.syntax ?? "icu",
      metadata,
      examples: string.examples ?? null,
      note: project.typeNotes?.[string.type] ?? null,
      glossary: Object.fromEntries(
        Object.entries(project.glossary ?? {}).map(([lang, entries]) => [
          lang,
          glossaryMatches(string.source, entries, string.syntax ?? "icu"),
        ]),
      ),
    },
    declarations,
    translations,
    entities: resolveRefs(
      db,
      projectId,
      declarations,
      metadata,
      project.entityTypes ?? {},
    ),
    history,
  };
}

// Ref fields, in declaration order, each expanded to the entities it names
// (missing targets are skipped: the push validated refs, but archival or a
// later push can still leave a dangling id).
function resolveRefs(
  db: Db,
  projectId: number,
  declarations: Record<string, FieldDeclaration>,
  metadata: Record<string, MetadataValue> | null,
  entityTypes: Record<string, { label: string }>,
): EntityCard[] {
  if (!metadata) return [];
  const wanted: { field: string; entityId: string }[] = [];
  for (const [field, decl] of Object.entries(declarations)) {
    if (decl.type !== "ref" && decl.type !== "list<ref>") continue;
    const value = metadata[field];
    const ids = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? [value]
        : [];
    for (const entityId of ids) wanted.push({ field, entityId });
  }
  if (wanted.length === 0) return [];

  const rows = db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.projectId, projectId),
        inArray(
          entities.entityId,
          wanted.map((w) => w.entityId),
        ),
      ),
    )
    .all();
  const byId = new Map(rows.map((row) => [row.entityId, row]));

  const cards: EntityCard[] = [];
  for (const { field, entityId } of wanted) {
    const row = byId.get(entityId);
    if (!row) continue;
    cards.push({
      field,
      entityId,
      type: row.type,
      typeLabel: entityTypes[row.type]?.label ?? row.type,
      name: row.name,
      attributes: row.attributes ?? null,
    });
  }
  return cards;
}
