import { and, asc, desc, eq, ne, notInArray, sql, type SQL } from "drizzle-orm";
import type { Library } from "@corpus/contract";
import type { Db } from "@/db";
import {
  edits,
  projects,
  strings,
  stringTranslations,
  users,
} from "@/db/schema";
import { takenRow } from "@/translations/taken";

// The dashboard queues (§9.1) over string × language rows, excluding
// archived strings (§11). Items are ordered by string id then language so
// next/previous is deterministic. Agent drafts are the translated rows an
// agent actor last edited (§10), a pile of their own for a maintainer.
export const QUEUE_KINDS = [
  "untranslated",
  "stale",
  "unverifiedSource",
  "agentDrafts",
  "invalid",
] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export function isQueueKind(value: unknown): value is QueueKind {
  return (QUEUE_KINDS as readonly unknown[]).includes(value);
}
// stringId is the internal row id; key is the client's snapshot id (§4),
// which the string route uses.
export type QueueItem = {
  stringId: number;
  key: string;
  language: string;
  type: string;
  source: string;
  text: string | null;
  // The repository's text to start from (#1050).
  suggestion?: string | null;
  // Read only where asked for, to validate the row (#873).
  syntax?: Library | null;
  arguments?: string[] | null;
  placeholders?: Library[] | null;
  pluralForms?: Record<string, string[]> | null;
  pluralShared?: Record<string, string[][]> | null;
};
export type Queue = {
  kind: QueueKind;
  count: number;
  first: QueueItem | null;
  items: QueueItem[];
};
export type QueueCounts = Record<QueueKind, number>;

type Filter = { language?: string | null; type?: string | null };

// Rows whose latest edit was an agent's (§10), in SQL: the list of such
// rows grows with every draft on the instance.
const agentLast = sql`(${stringTranslations.stringId}, ${stringTranslations.language}) in (
  select e.string_id, e.language from ${edits} e
  join ${users} u on u.id = e.user_id
  where u.agent = 1 and e.id in (
    select max(id) from ${edits} group by string_id, language
  )
)`;

// The project's source language, and the target languages that are
// variants of it (#658), whose untranslated rows fall back to the
// source and are no work.
type Scope = { sourceLanguage: string; variants: string[] };

function condition(kind: QueueKind, { sourceLanguage, variants }: Scope) {
  switch (kind) {
    case "untranslated":
      return and(
        ne(stringTranslations.language, sourceLanguage),
        eq(stringTranslations.state, "untranslated"),
        variants.length > 0
          ? notInArray(stringTranslations.language, variants)
          : undefined,
      );
    case "stale":
      return eq(stringTranslations.stale, true);
    case "unverifiedSource":
      return and(
        eq(stringTranslations.language, sourceLanguage),
        eq(stringTranslations.state, "translated"),
      );
    case "agentDrafts":
      return and(eq(stringTranslations.state, "translated"), agentLast);
    case "invalid":
      return eq(stringTranslations.invalid, true);
  }
}

function scopeOf(db: Db, projectId: number): Scope {
  const project = db
    .select({
      sourceLanguage: projects.sourceLanguage,
      variants: projects.sourceVariants,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  return {
    sourceLanguage: project?.sourceLanguage ?? "",
    variants: project?.variants ?? [],
  };
}

function where(
  projectId: number,
  kind: QueueKind,
  scope: Scope,
  filter: Filter,
) {
  // The invalid rows are few and indexed apart (translations_invalid), so
  // that queue starts from them: its CROSS JOIN keeps SQLite from walking
  // the project's strings first, as it would on a database without
  // statistics (#858).
  return and(
    kind === "invalid"
      ? eq(strings.id, stringTranslations.stringId)
      : undefined,
    eq(strings.projectId, projectId),
    eq(strings.archived, false),
    takenRow,
    condition(kind, scope),
    filter.language != null
      ? eq(stringTranslations.language, filter.language)
      : undefined,
    filter.type != null ? eq(strings.type, filter.type) : undefined,
  );
}

function select(
  db: Db,
  projectId: number,
  kind: QueueKind,
  scope: Scope,
  filter: Filter,
  limit?: number,
  withLibrary = false,
  withSuggestion = false,
): QueueItem[] {
  const from = db
    .select({
      stringId: stringTranslations.stringId,
      key: strings.stringId,
      type: strings.type,
      language: stringTranslations.language,
      source: strings.source,
      text: stringTranslations.text,
      ...(withSuggestion && { suggestion: stringTranslations.suggestion }),
      ...(withLibrary && {
        syntax: strings.syntax,
        arguments: strings.arguments,
        placeholders: strings.placeholders,
        pluralForms: strings.pluralForms,
        pluralShared: strings.pluralShared,
      }),
    })
    .from(stringTranslations);
  const query = (
    kind === "invalid"
      ? from.crossJoin(strings)
      : from.innerJoin(strings, eq(strings.id, stringTranslations.stringId))
  )
    .where(where(projectId, kind, scope, filter))
    .orderBy(asc(strings.id), asc(stringTranslations.language));
  return limit === undefined ? query.all() : query.limit(limit).all();
}

function count(
  db: Db,
  projectId: number,
  kind: QueueKind,
  scope: Scope,
): number {
  const from = db
    .select({ count: sql<number>`count(*)` })
    .from(stringTranslations);
  return (
    (kind === "invalid"
      ? from.crossJoin(strings)
      : from.innerJoin(strings, eq(strings.id, stringTranslations.stringId))
    )
      .where(where(projectId, kind, scope, {}))
      .get()?.count ?? 0
  );
}

export function queueItems(
  db: Db,
  projectId: number,
  kind: QueueKind,
  filter: Filter = {},
  withLibrary = false,
  // The repository's text to start from, for an agent (#1050).
  withSuggestion = false,
): Queue {
  const items = select(
    db,
    projectId,
    kind,
    scopeOf(db, projectId),
    filter,
    undefined,
    withLibrary,
    withSuggestion,
  );
  return { kind, count: items.length, first: items[0] ?? null, items };
}

// The dashboard's view (§9.1): each queue's count and its first item.
export function queueSummaries(
  db: Db,
  projectId: number,
): Record<QueueKind, { count: number; first: QueueItem | null }> {
  const source = scopeOf(db, projectId);
  const summary = (kind: QueueKind) => ({
    count: count(db, projectId, kind, source),
    first: select(db, projectId, kind, source, {}, 1)[0] ?? null,
  });
  return {
    untranslated: summary("untranslated"),
    stale: summary("stale"),
    unverifiedSource: summary("unverifiedSource"),
    agentDrafts: summary("agentDrafts"),
    invalid: summary("invalid"),
  };
}

export function queueCounts(db: Db, projectId: number): QueueCounts {
  const source = scopeOf(db, projectId);
  return {
    untranslated: count(db, projectId, "untranslated", source),
    stale: count(db, projectId, "stale", source),
    unverifiedSource: count(db, projectId, "unverifiedSource", source),
    agentDrafts: count(db, projectId, "agentDrafts", source),
    invalid: count(db, projectId, "invalid", source),
  };
}

type Current = Pick<QueueItem, "stringId" | "language">;

// One row's place in a queue for the string page (§9.3), without loading
// the whole queue (#639): its previous and next, its position and the
// queue's count, and the queue's languages for its string, for the
// language bar. A row not in the queue has no position, no neighbours
// and no count.
export type QueueStep = {
  kind: QueueKind;
  index: number | null;
  previous: QueueItem | null;
  next: QueueItem | null;
  count: number | null;
  languages: string[];
};

// Queues read whole, where one read costs least: the invalid rows start
// from their own index (#858), agent drafts' latest-edit subquery runs
// once, and stale rows have no index of their own, so any query on them
// scans the rows and a walk would scan them more than once.
const READ_WHOLE: ReadonlySet<QueueKind> = new Set([
  "invalid",
  "agentDrafts",
  "stale",
]);

const fields = {
  stringId: stringTranslations.stringId,
  key: strings.stringId,
  type: strings.type,
  language: stringTranslations.language,
  source: strings.source,
  text: stringTranslations.text,
};
const row = sql`(${stringTranslations.stringId}, ${stringTranslations.language})`;
const at = (current: Current) =>
  sql`(${current.stringId}, ${current.language})`;

// The queue's row before or after `current`, or the row itself. The
// translations drive the CROSS JOIN, in their (string_id, language)
// index's order, which is the queue's (strings.id is string_id): SQLite
// then walks that index from the row and stops at the first match, with
// or without statistics, where a join it orders freely sorts the whole
// queue first.
function walk(
  db: Db,
  projectId: number,
  kind: QueueKind,
  scope: Scope,
  current: Current,
  direction: "previous" | "next" | "here",
): QueueItem | null {
  const order = direction === "previous" ? desc : asc;
  const position =
    direction === "previous"
      ? sql`${row} < ${at(current)}`
      : direction === "next"
        ? sql`${row} > ${at(current)}`
        : and(
            eq(stringTranslations.stringId, current.stringId),
            eq(stringTranslations.language, current.language),
          );
  return (
    db
      .select(fields)
      .from(stringTranslations)
      .crossJoin(strings)
      .where(
        and(
          eq(strings.id, stringTranslations.stringId),
          where(projectId, kind, scope, {}),
          position,
        ),
      )
      .orderBy(
        order(stringTranslations.stringId),
        order(stringTranslations.language),
      )
      .limit(1)
      .get() ?? null
  );
}

function fromList(items: QueueItem[], current: Current) {
  const index = items.findIndex(
    (item) =>
      item.stringId === current.stringId && item.language === current.language,
  );
  return index < 0
    ? { index: null, previous: null, next: null }
    : {
        index,
        previous: items[index - 1] ?? null,
        next: items[index + 1] ?? null,
      };
}

// The rows before and after `current`, computed before a transition so
// "next" still points past the item that is about to leave the queue:
// what a save needs, a membership check and two LIMIT 1 walks.
export function queueNeighbours(
  db: Db,
  projectId: number,
  kind: QueueKind,
  current: Current,
): { previous: QueueItem | null; next: QueueItem | null } {
  const scope = scopeOf(db, projectId);
  if (READ_WHOLE.has(kind)) {
    const { previous, next } = fromList(
      select(db, projectId, kind, scope, {}),
      current,
    );
    return { previous, next };
  }
  if (!walk(db, projectId, kind, scope, current, "here"))
    return { previous: null, next: null };
  return {
    previous: walk(db, projectId, kind, scope, current, "previous"),
    next: walk(db, projectId, kind, scope, current, "next"),
  };
}

export function queueStep(
  db: Db,
  projectId: number,
  kind: QueueKind,
  current: Current,
): QueueStep {
  const scope = scopeOf(db, projectId);
  if (READ_WHOLE.has(kind)) {
    const items = select(db, projectId, kind, scope, {});
    const around = fromList(items, current);
    return {
      kind,
      ...around,
      count: around.index === null ? null : items.length,
      languages: items
        .filter((item) => item.stringId === current.stringId)
        .map((item) => item.language),
    };
  }
  const languages = rows(
    db,
    projectId,
    kind,
    scope,
    eq(strings.id, current.stringId),
  ).map((item) => item.language);
  if (!walk(db, projectId, kind, scope, current, "here"))
    return {
      kind,
      index: null,
      previous: null,
      next: null,
      count: null,
      languages,
    };
  // Position and count in one pass over the queue.
  const tally = db
    .select({
      count: sql<number>`count(*)`,
      before: sql<number>`coalesce(sum(${row} < ${at(current)}), 0)`,
    })
    .from(stringTranslations)
    .innerJoin(strings, eq(strings.id, stringTranslations.stringId))
    .where(where(projectId, kind, scope, {}))
    .get();
  return {
    kind,
    index: tally?.before ?? 0,
    previous: walk(db, projectId, kind, scope, current, "previous"),
    next: walk(db, projectId, kind, scope, current, "next"),
    count: tally?.count ?? 0,
    languages,
  };
}

// The queue's rows for one string, in its order.
function rows(
  db: Db,
  projectId: number,
  kind: QueueKind,
  scope: Scope,
  extra: SQL | undefined,
): QueueItem[] {
  return db
    .select(fields)
    .from(stringTranslations)
    .innerJoin(strings, eq(strings.id, stringTranslations.stringId))
    .where(and(where(projectId, kind, scope, {}), extra))
    .orderBy(asc(strings.id), asc(stringTranslations.language))
    .all();
}
