import { and, eq } from "drizzle-orm";
import {
  CONTRACT_VERSION,
  MIN_STATES,
  type MinState,
  type PullPayload,
} from "@corpus/contract";
import type { Db } from "@/db";
import { strings, stringTranslations } from "@/db/schema";
import { sourceChangesFor } from "@/proposals/service";

const RANK: Record<MinState, number> = Object.fromEntries(
  MIN_STATES.map((state, index) => [state, index]),
) as Record<MinState, number>;

// Build the pull payload (§8) for a project: rows at or above minState
// with text, archived strings excluded, every configured language
// present, or only the ones asked for.
export function pullPayload(
  db: Db,
  project: {
    id: number;
    slug: string;
    sourceLanguage: string;
    languages: string[];
  },
  minState: MinState,
  only: string[] = project.languages,
): PullPayload {
  const rows = db
    .select({
      id: strings.stringId,
      type: strings.type,
      source: strings.source,
      language: stringTranslations.language,
      text: stringTranslations.text,
      state: stringTranslations.state,
    })
    .from(stringTranslations)
    .innerJoin(strings, eq(strings.id, stringTranslations.stringId))
    .where(and(eq(strings.projectId, project.id), eq(strings.archived, false)))
    .all();

  // Keys come from pushed data; null-prototype maps keep a key such as
  // __proto__ an ordinary key.
  const types: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  const translations: Record<string, Record<string, string>> = Object.create(
    null,
  ) as Record<string, Record<string, string>>;
  const bucket = () => Object.create(null) as Record<string, string>;
  const wanted = new Set(only);
  for (const language of only) translations[language] = bucket();
  for (const row of rows) {
    types[row.id] = row.type;
    if (!wanted.has(row.language)) continue;
    // The source row's text is the string's source (§8); its translation
    // row only carries state.
    const text =
      row.language === project.sourceLanguage ? row.source : row.text;
    if (text === null || RANK[row.state] < RANK[minState]) continue;
    (translations[row.language] ??= bucket())[row.id] = text;
  }
  const sourceChanges = sourceChangesFor(db, project.id);
  return {
    contract: CONTRACT_VERSION,
    project: project.slug,
    sourceLanguage: project.sourceLanguage,
    minState,
    types,
    translations,
    ...(sourceChanges.length > 0 && { sourceChanges }),
  };
}
