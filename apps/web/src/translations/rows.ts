import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { strings, stringTranslations } from "@/db/schema";

// A string takes a language unless it names the ones it takes (#1006).
const takes = (language: string) =>
  sql`(${strings.languages} is null or ${language} in (select value from json_each(${strings.languages})))`;

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
  let inserted = 0;
  // One statement per language, so a push on a large project pays one
  // query per target language rather than one insert per string.
  for (const language of languages) {
    const result = db.run(sql`
      insert into ${stringTranslations} (string_id, language, state, updated_at)
      select ${strings.id}, ${language}, 'untranslated', ${Date.now()}
      from ${strings}
      where ${strings.projectId} = ${projectId}
        and ${strings.archived} = 0
        and ${takes(language)}
        and not exists (
          select 1 from ${stringTranslations} t
          where t.string_id = ${strings.id} and t.language = ${language}
        )
    `);
    inserted += Number(result.changes);
  }
  return inserted;
}

// A row outside the languages its string names (#1006) that holds
// nothing goes: an insert's, or one a push's narrowed set left. One that
// holds a translation stays, out of every view, so a set narrowed and
// widened again loses no work.
export function dropUntakenRows(db: Db, projectId: number): void {
  db.run(sql`
    delete from ${stringTranslations}
    where ${stringTranslations.text} is null
      and ${stringTranslations.stringId} in (
        select ${strings.id} from ${strings}
        where ${strings.projectId} = ${projectId}
          and ${strings.languages} is not null
      )
      and ${stringTranslations.language} not in (
        select value from json_each((
          select ${strings.languages} from ${strings}
          where ${strings.id} = ${stringTranslations.stringId}
        ))
      )
  `);
}
