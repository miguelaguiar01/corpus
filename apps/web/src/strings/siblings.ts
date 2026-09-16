// A string's siblings (§9.3): the other active strings of the same type
// whose key shares its prefix up to the last dot, in key order; the ten
// nearest, five before and five after where they exist and filled from
// the other side otherwise, with the total.
import { and, asc, eq, inArray, like, ne } from "drizzle-orm";
import type { Db } from "@/db";
import { strings, stringTranslations } from "@/db/schema";
import type { TranslationState } from "@/translations/state";

export const SIBLINGS_SHOWN = 10;

export type Sibling = {
  id: number;
  key: string;
  source: string;
  translations: Record<
    string,
    { state: TranslationState; stale: boolean; text: string | null }
  >;
};

export type Siblings = { total: number; items: Sibling[] };

export function siblingPrefix(key: string): string | null {
  const dot = key.lastIndexOf(".");
  return dot < 0 ? null : key.slice(0, dot);
}

// The window around the string's own place in key order.
export function nearest<T extends { key: string }>(
  sorted: T[],
  key: string,
  shown = SIBLINGS_SHOWN,
): T[] {
  if (sorted.length <= shown) return sorted;
  const after = sorted.findIndex((s) => s.key > key);
  const firstAfter = after < 0 ? sorted.length : after;
  const half = Math.floor(shown / 2);
  let start = firstAfter - half;
  if (start < 0) start = 0;
  if (start + shown > sorted.length) start = sorted.length - shown;
  return sorted.slice(start, start + shown);
}

export function siblingsOf(
  db: Db,
  projectId: number,
  string: { id: number; key: string; type: string },
): Siblings {
  const prefix = siblingPrefix(string.key);
  if (prefix === null) return { total: 0, items: [] };
  const rows = db
    .select({ id: strings.id, key: strings.stringId, source: strings.source })
    .from(strings)
    .where(
      and(
        eq(strings.projectId, projectId),
        eq(strings.type, string.type),
        eq(strings.archived, false),
        ne(strings.id, string.id),
        like(strings.stringId, `${prefix}.%`),
      ),
    )
    .orderBy(asc(strings.stringId))
    .all()
    // LIKE is a prefix match on the dotted path; keep the direct family
    // and its descendants alike, as the spec's "shares the prefix" says.
    .filter((row) => row.key.startsWith(`${prefix}.`));
  const shown = nearest(rows, string.key);
  const translations = shown.length
    ? db
        .select()
        .from(stringTranslations)
        .where(
          inArray(
            stringTranslations.stringId,
            shown.map((s) => s.id),
          ),
        )
        .all()
    : [];
  const byString = new Map<number, Sibling["translations"]>();
  for (const row of translations) {
    const entry = byString.get(row.stringId) ?? {};
    entry[row.language] = {
      state: row.state,
      stale: row.stale,
      text: row.text,
    };
    byString.set(row.stringId, entry);
  }
  return {
    total: rows.length,
    items: shown.map((s) => ({ ...s, translations: byString.get(s.id) ?? {} })),
  };
}
