import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { projects, strings, stringTranslations } from "@/db/schema";
import { agentEditedRows, rowKey } from "@/agents/latest-edit";

// The dashboard queues (§9.1) over string × language rows, excluding
// archived strings (§11). Items are ordered by string id then language so
// next/previous is deterministic. Agent drafts are the translated rows an
// agent actor last edited (§10), a pile of their own for a maintainer.
export const QUEUE_KINDS = [
  "untranslated",
  "stale",
  "unverifiedSource",
  "agentDrafts",
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

// Each queue is a condition in SQL (#603): a 586k-row project loaded
// every row to filter it here, seconds a request. Agent drafts are the
// translated rows of the strings an agent last edited, few, checked
// exactly by row after.
function condition(
  kind: QueueKind,
  sourceLanguage: string,
  agentIds: number[],
) {
  switch (kind) {
    case "untranslated":
      return and(
        ne(stringTranslations.language, sourceLanguage),
        eq(stringTranslations.state, "untranslated"),
      );
    case "stale":
      return eq(stringTranslations.stale, true);
    case "unverifiedSource":
      return and(
        eq(stringTranslations.language, sourceLanguage),
        eq(stringTranslations.state, "translated"),
      );
    case "agentDrafts":
      return and(
        eq(stringTranslations.state, "translated"),
        inArray(stringTranslations.stringId, agentIds),
      );
  }
}

function scope(db: Db, projectId: number) {
  const project = db
    .select({ sourceLanguage: projects.sourceLanguage })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  const agentEdited = agentEditedRows(db);
  const agentIds = [
    ...new Set([...agentEdited].map((key) => Number(key.split(" ")[0]))),
  ];
  return {
    sourceLanguage: project?.sourceLanguage ?? "",
    agentEdited,
    agentIds,
  };
}

function where(
  projectId: number,
  kind: QueueKind,
  context: ReturnType<typeof scope>,
  filter: Filter,
) {
  return and(
    eq(strings.projectId, projectId),
    eq(strings.archived, false),
    condition(kind, context.sourceLanguage, context.agentIds),
    filter.language
      ? eq(stringTranslations.language, filter.language)
      : undefined,
    filter.type ? eq(strings.type, filter.type) : undefined,
  );
}

function select(
  db: Db,
  projectId: number,
  kind: QueueKind,
  context: ReturnType<typeof scope>,
  filter: Filter,
  limit?: number,
): QueueItem[] {
  const query = db
    .select({
      stringId: stringTranslations.stringId,
      key: strings.stringId,
      type: strings.type,
      language: stringTranslations.language,
      source: strings.source,
      text: stringTranslations.text,
    })
    .from(stringTranslations)
    .innerJoin(strings, eq(strings.id, stringTranslations.stringId))
    .where(where(projectId, kind, context, filter))
    .orderBy(asc(strings.id), asc(stringTranslations.language));
  const rows =
    kind === "agentDrafts" || limit === undefined
      ? query.all()
      : query.limit(limit).all();
  const items =
    kind === "agentDrafts"
      ? rows.filter((row) =>
          context.agentEdited.has(rowKey(row.stringId, row.language)),
        )
      : rows;
  return limit === undefined ? items : items.slice(0, limit);
}

function count(
  db: Db,
  projectId: number,
  kind: QueueKind,
  context: ReturnType<typeof scope>,
): number {
  if (kind === "agentDrafts")
    return select(db, projectId, kind, context, {}).length;
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(stringTranslations)
      .innerJoin(strings, eq(strings.id, stringTranslations.stringId))
      .where(where(projectId, kind, context, {}))
      .get()?.count ?? 0
  );
}

export function queueItems(
  db: Db,
  projectId: number,
  kind: QueueKind,
  filter: Filter = {},
): Queue {
  const items = select(db, projectId, kind, scope(db, projectId), filter);
  return { kind, count: items.length, first: items[0] ?? null, items };
}

// The dashboard's view (§9.1): each queue's count and its first item.
export function queueSummaries(
  db: Db,
  projectId: number,
): Record<QueueKind, { count: number; first: QueueItem | null }> {
  const context = scope(db, projectId);
  const summary = (kind: QueueKind) => ({
    count: count(db, projectId, kind, context),
    first: select(db, projectId, kind, context, {}, 1)[0] ?? null,
  });
  return {
    untranslated: summary("untranslated"),
    stale: summary("stale"),
    unverifiedSource: summary("unverifiedSource"),
    agentDrafts: summary("agentDrafts"),
  };
}

export function queueCounts(db: Db, projectId: number): QueueCounts {
  const context = scope(db, projectId);
  return {
    untranslated: count(db, projectId, "untranslated", context),
    stale: count(db, projectId, "stale", context),
    unverifiedSource: count(db, projectId, "unverifiedSource", context),
    agentDrafts: count(db, projectId, "agentDrafts", context),
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
