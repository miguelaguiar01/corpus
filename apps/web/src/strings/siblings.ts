// A string's siblings (§9.3): the other active strings of the same type
// whose key shares its prefix up to the last dot, and its i18next plural
// family (the base key and its suffix forms), in key order; the ten
// nearest, five before and five after where they exist and filled from
// the other side otherwise, with the total.
import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import type { Db } from "@/db";
import { strings, stringTranslations } from "@/db/schema";
import type { TranslationState } from "@/translations/state";

const SIBLINGS_SHOWN = 10;

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

// A key with whitespace is a sentence, not a path, and has no prefix:
// its dots end clauses, not segments.
export function siblingPrefix(key: string): string | null {
  if (/\s/.test(key)) return null;
  const dot = key.lastIndexOf(".");
  return dot < 0 ? null : key.slice(0, dot);
}

const PLURAL_SUFFIXES = [
  "_plural",
  "_zero",
  "_one",
  "_two",
  "_few",
  "_many",
  "_other",
];

// i18next's plural forms are keys beside the base (`starred`,
// `starred_plural`, `starred_one`): one family, whatever the key's shape.
export function pluralFamily(key: string): { base: string; keys: string[] } {
  const suffix = PLURAL_SUFFIXES.find(
    (s) => key.endsWith(s) && key.length > s.length,
  );
  const base = suffix ? key.slice(0, -suffix.length) : key;
  return { base, keys: [base, ...PLURAL_SUFFIXES.map((s) => base + s)] };
}

// Key order by code point, the order SQLite's BINARY collation gives
// bytes, so the window is taken in the same order the rows came in.
export function compareKeys(a: string, b: string): number {
  const as = [...a];
  const bs = [...b];
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const d = as[i]!.codePointAt(0)! - bs[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return as.length - bs.length;
}

// The window around the string's own place in key order.
export function nearest<T extends { key: string }>(
  sorted: T[],
  key: string,
  shown = SIBLINGS_SHOWN,
): T[] {
  if (sorted.length <= shown) return sorted;
  const after = sorted.findIndex((s) => compareKeys(s.key, key) > 0);
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
  string: { id: number; key: string; type: string; sourceLanguage: string },
): Siblings {
  const prefix = siblingPrefix(string.key);
  const family = pluralFamily(string.key).keys.filter((k) => k !== string.key);
  const own = and(
    eq(strings.projectId, projectId),
    eq(strings.type, string.type),
    eq(strings.archived, false),
    ne(strings.id, string.id),
  );
  const select = () =>
    db.select({
      id: strings.id,
      key: strings.stringId,
      source: strings.source,
    });
  // A range on the key index, case-sensitive and wildcard-free: every
  // key under `prefix.` sorts between `prefix.` and `prefix/`. Deeper
  // keys land in the range too and are dropped, since their own prefix
  // is longer.
  const underPrefix =
    prefix === null
      ? []
      : select()
          .from(strings)
          .where(
            and(
              own,
              gte(strings.stringId, `${prefix}.`),
              lt(strings.stringId, `${prefix}/`),
            ),
          )
          .all()
          .filter((row) => siblingPrefix(row.key) === prefix);
  const inFamily = select()
    .from(strings)
    .where(and(own, inArray(strings.stringId, family)))
    .all();
  const rows = [
    ...new Map(
      [...underPrefix, ...inFamily].map((row) => [row.id, row]),
    ).values(),
  ].sort((a, b) => compareKeys(a.key, b.key));
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
    if (row.language === string.sourceLanguage) continue;
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
