import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { strings, stringTranslations } from "@/db/schema";

// Every active string has a row per project language (§11). Push creates
// them for the strings it inserts; this fills the gaps for a language
// that joined the project later, so the dashboard, the queues and the
// catalogue show the language at once. Rows that exist are left alone.
export function ensureTranslationRows(
  db: Db,
  projectId: number,
  languages: string[],
): number {
  if (languages.length === 0) return 0;
  const active = db
    .select({ id: strings.id })
    .from(strings)
    .where(and(eq(strings.projectId, projectId), eq(strings.archived, false)))
    .all();
  let inserted = 0;
  for (const language of languages) {
    for (const row of active) {
      const result = db
        .insert(stringTranslations)
        .values({ stringId: row.id, language, state: "untranslated" })
        .onConflictDoNothing()
        .run();
      inserted += result.changes;
    }
  }
  return inserted;
}
