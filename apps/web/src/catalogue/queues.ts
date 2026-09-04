import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { projects, strings, stringTranslations } from "@/db/schema";

// The three dashboard queues (§9.1) over string × language rows, excluding
// archived strings (§11). Items are ordered by string id then language so
// next/previous is deterministic.
export type QueueKind = "untranslated" | "stale" | "unverifiedSource";
export type QueueItem = { stringId: number; language: string };
export type Queue = {
  kind: QueueKind;
  count: number;
  first: QueueItem | null;
  items: QueueItem[];
};
export type QueueCounts = Record<QueueKind, number>;

type Row = {
  stringId: number;
  language: string;
  state: string;
  stale: boolean;
  isSource: boolean;
};

const MATCHERS: Record<QueueKind, (row: Row) => boolean> = {
  untranslated: (row) => !row.isSource && row.state === "untranslated",
  stale: (row) => row.stale,
  unverifiedSource: (row) => row.isSource && row.state === "translated",
};

function loadRows(db: Db, projectId: number): Row[] {
  return db
    .select({
      stringId: stringTranslations.stringId,
      language: stringTranslations.language,
      state: stringTranslations.state,
      stale: stringTranslations.stale,
      sourceLanguage: projects.sourceLanguage,
    })
    .from(stringTranslations)
    .innerJoin(strings, eq(strings.id, stringTranslations.stringId))
    .innerJoin(projects, eq(projects.id, strings.projectId))
    .where(and(eq(strings.projectId, projectId), eq(strings.archived, false)))
    .orderBy(asc(strings.id), asc(stringTranslations.language))
    .all()
    .map(({ sourceLanguage, ...row }) => ({
      ...row,
      isSource: row.language === sourceLanguage,
    }));
}

export function queueItems(db: Db, projectId: number, kind: QueueKind): Queue {
  const items = loadRows(db, projectId)
    .filter(MATCHERS[kind])
    .map(({ stringId, language }) => ({ stringId, language }));
  return { kind, count: items.length, first: items[0] ?? null, items };
}

export function queueCounts(db: Db, projectId: number): QueueCounts {
  const rows = loadRows(db, projectId);
  return {
    untranslated: rows.filter(MATCHERS.untranslated).length,
    stale: rows.filter(MATCHERS.stale).length,
    unverifiedSource: rows.filter(MATCHERS.unverifiedSource).length,
  };
}
