import { and, asc, eq, exists, gt, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { strings, stringTranslations } from "@/db/schema";

export type TranslationState = "untranslated" | "translated" | "verified";
export type LanguageState = { state: TranslationState; stale: boolean };

export type CatalogueRow = {
  id: number;
  stringId: string;
  type: string;
  source: string;
  archived: boolean;
  states: Record<string, LanguageState>;
};

export type CataloguePage = { rows: CatalogueRow[]; nextCursor: number | null };

export type CatalogueFilters = {
  types?: string[];
  // Metadata equality: field -> value ("true"/"false" for flags).
  metadata?: Record<string, string>;
  language?: string;
  states?: TranslationState[];
  stringIds?: number[];
};

export type CatalogueOptions = CatalogueFilters & {
  includeArchived?: boolean;
  cursor?: number;
  limit?: number;
};

// The catalogue list (§9.2): strings for a project with their per-language
// states (§11), cursor-paginated by internal id. Archived strings are
// hidden unless asked for.
export function listCatalogue(
  db: Db,
  projectId: number,
  options: CatalogueOptions = {},
): CataloguePage {
  const limit = options.limit ?? 50;
  const cursor = options.cursor ?? 0;

  const conditions: SQL[] = [
    eq(strings.projectId, projectId),
    gt(strings.id, cursor),
  ];
  if (!options.includeArchived) conditions.push(eq(strings.archived, false));
  if (options.types?.length) {
    conditions.push(inArray(strings.type, options.types));
  }
  if (options.stringIds) {
    // Empty means "search matched nothing" → no rows.
    if (options.stringIds.length === 0) return { rows: [], nextCursor: null };
    conditions.push(inArray(strings.id, options.stringIds));
  }
  for (const [field, value] of Object.entries(options.metadata ?? {})) {
    conditions.push(
      sql`json_extract(${strings.metadata}, ${"$." + field}) = ${jsonValue(value)}`,
    );
  }
  if (options.language && options.states?.length) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(stringTranslations)
          .where(
            and(
              eq(stringTranslations.stringId, strings.id),
              eq(stringTranslations.language, options.language),
              inArray(stringTranslations.state, options.states),
            ),
          ),
      ),
    );
  }

  const found = db
    .select()
    .from(strings)
    .where(and(...conditions))
    .orderBy(asc(strings.id))
    .limit(limit + 1)
    .all();

  const hasMore = found.length > limit;
  const page = hasMore ? found.slice(0, limit) : found;
  const ids = page.map((row) => row.id);

  const translations = ids.length
    ? db
        .select()
        .from(stringTranslations)
        .where(inArray(stringTranslations.stringId, ids))
        .all()
    : [];

  const statesByString = new Map<number, Record<string, LanguageState>>();
  for (const row of translations) {
    const states = statesByString.get(row.stringId) ?? {};
    states[row.language] = { state: row.state, stale: row.stale };
    statesByString.set(row.stringId, states);
  }

  return {
    rows: page.map((row) => ({
      id: row.id,
      stringId: row.stringId,
      type: row.type,
      source: row.source,
      archived: row.archived,
      states: statesByString.get(row.id) ?? {},
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

// Flags are stored as JSON booleans; enums/refs as strings.
function jsonValue(value: string): string | number {
  if (value === "true") return 1;
  if (value === "false") return 0;
  return value;
}
