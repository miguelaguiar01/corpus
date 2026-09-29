import { and, asc, eq, ne, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  edits,
  projects,
  strings,
  stringTranslations,
  users,
} from "@/db/schema";

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
): QueueItem[] {
  const from = db
    .select({
      stringId: stringTranslations.stringId,
      key: strings.stringId,
      type: strings.type,
      language: stringTranslations.language,
      source: strings.source,
      text: stringTranslations.text,
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
): Queue {
  const items = select(db, projectId, kind, scopeOf(db, projectId), filter);
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

// Position of an item in a queue plus its neighbours, for next/previous.
// Computed before a transition so "next" still points past the item that
// is about to leave the queue.
export function neighbours(
  queue: Queue,
  current: Pick<QueueItem, "stringId" | "language">,
): {
  index: number | null;
  previous: QueueItem | null;
  next: QueueItem | null;
} {
  const index = queue.items.findIndex(
    (item) =>
      item.stringId === current.stringId && item.language === current.language,
  );
  if (index < 0) return { index: null, previous: null, next: null };
  return {
    index,
    previous: queue.items[index - 1] ?? null,
    next: queue.items[index + 1] ?? null,
  };
}
