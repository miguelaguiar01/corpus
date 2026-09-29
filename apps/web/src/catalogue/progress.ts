import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { strings, stringTranslations } from "@/db/schema";
import type { TranslationState } from "./query";

export type LanguageProgress = {
  untranslated: number;
  translated: number;
  verified: number;
  stale: number;
  // Seeded translations that fail validation (#646), within translated.
  invalid: number;
  total: number;
};

export type Progress = {
  perLanguage: Record<string, LanguageProgress>;
  perType: Record<string, Record<string, LanguageProgress>>;
};

export function emptyProgress(): LanguageProgress {
  return {
    untranslated: 0,
    translated: 0,
    verified: 0,
    stale: 0,
    invalid: 0,
    total: 0,
  };
}

// Progress numbers over string×language states, excluding archived strings
// (§11). Broken down per language and per string type (§9.2). The invalid
// count is `/api/status`'s (§9.1); a page that shows no count of them
// skips it.
export function progressCounts(
  db: Db,
  projectId: number,
  { invalid: countInvalid = true } = {},
): Progress {
  const types = db
    .selectDistinct({ type: strings.type })
    .from(strings)
    .where(and(eq(strings.projectId, projectId), eq(strings.archived, false)))
    .all()
    .map((row) => row.type);
  // Counted in SQL (#603). With one type the counts stream from the
  // (language, state) index; CROSS JOIN keeps SQLite from starting at
  // strings, which a database without statistics would. Several types
  // need a sort by type, still well under loading every row.
  const rows: {
    language: string;
    state: string;
    type: string;
    count: number;
    stale: number;
  }[] =
    types.length === 1
      ? db
          .all<{
            language: string;
            state: string;
            count: number;
            stale: number;
          }>(
            sql`select st.language as language, st.state as state,
                  count(*) as count, sum(st.stale) as stale
                from ${stringTranslations} st cross join ${strings} s
                  on s.id = st.string_id
                where s.project_id = ${projectId} and s.archived = 0
                group by st.language, st.state`,
          )
          .map((row) => ({ ...row, type: types[0]! }))
      : db
          .select({
            language: stringTranslations.language,
            state: stringTranslations.state,
            type: strings.type,
            count: sql<number>`count(*)`,
            stale: sql<number>`sum(${stringTranslations.stale})`,
          })
          .from(stringTranslations)
          .innerJoin(strings, eq(strings.id, stringTranslations.stringId))
          .where(
            and(eq(strings.projectId, projectId), eq(strings.archived, false)),
          )
          .groupBy(
            stringTranslations.language,
            strings.type,
            stringTranslations.state,
          )
          .all();

  // Keys come from pushed data; null-prototype maps keep a key such as
  // __proto__ an ordinary key.
  const progress: Progress = {
    perLanguage: Object.create(null) as Progress["perLanguage"],
    perType: Object.create(null) as Progress["perType"],
  };
  for (const row of rows) {
    const lang = (progress.perLanguage[row.language] ??= emptyProgress());
    const byType = (progress.perType[row.type] ??= Object.create(
      null,
    ) as Record<string, LanguageProgress>);
    const typeLang = (byType[row.language] ??= emptyProgress());
    for (const bucket of [lang, typeLang]) {
      bucket[row.state as TranslationState] += row.count;
      bucket.total += row.count;
      bucket.stale += row.stale;
    }
  }
  if (!countInvalid) return progress;
  // Few rows, read through their partial index.
  const invalid = db.all<{ language: string; type: string; count: number }>(
    sql`select st.language as language, s.type as type, count(*) as count
        from ${stringTranslations} st cross join ${strings} s
          on s.id = st.string_id
        where st.invalid = 1 and s.project_id = ${projectId}
          and s.archived = 0
        group by st.language, s.type`,
  );
  for (const row of invalid) {
    const lang = progress.perLanguage[row.language];
    const typeLang = progress.perType[row.type]?.[row.language];
    if (lang) lang.invalid += row.count;
    if (typeLang) typeLang.invalid += row.count;
  }
  return progress;
}
