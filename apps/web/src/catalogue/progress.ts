import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { strings, stringTranslations } from "@/db/schema";
import type { TranslationState } from "./query";

export type LanguageProgress = {
  untranslated: number;
  translated: number;
  verified: number;
  stale: number;
  total: number;
};

export type Progress = {
  perLanguage: Record<string, LanguageProgress>;
  perType: Record<string, Record<string, LanguageProgress>>;
};

export function emptyProgress(): LanguageProgress {
  return { untranslated: 0, translated: 0, verified: 0, stale: 0, total: 0 };
}

// Progress numbers over string×language states, excluding archived strings
// (§11). Broken down per language and per string type (§9.2).
export function progressCounts(db: Db, projectId: number): Progress {
  const rows = db
    .select({
      language: stringTranslations.language,
      state: stringTranslations.state,
      stale: stringTranslations.stale,
      type: strings.type,
    })
    .from(stringTranslations)
    .innerJoin(strings, eq(strings.id, stringTranslations.stringId))
    .where(and(eq(strings.projectId, projectId), eq(strings.archived, false)))
    .all();

  const progress: Progress = { perLanguage: {}, perType: {} };
  for (const row of rows) {
    const lang = (progress.perLanguage[row.language] ??= emptyProgress());
    const byType = (progress.perType[row.type] ??= {});
    const typeLang = (byType[row.language] ??= emptyProgress());
    for (const bucket of [lang, typeLang]) {
      bucket[row.state as TranslationState] += 1;
      bucket.total += 1;
      if (row.stale) bucket.stale += 1;
    }
  }
  return progress;
}
