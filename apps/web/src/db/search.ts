import { sql } from "drizzle-orm";
import type { Db } from "./index";

// Accent-insensitive full-text search over string source text (§9.2).
// The FTS5 table (migration 0002) uses unicode61 + remove_diacritics and
// stays in sync with `strings` via triggers, so ingest needs no special
// handling. Returns the ids of every string in the project whose source
// matches — archived-or-not, since the catalogue's own archived filter
// owns visibility (the results are always intersected there). An empty
// query matches nothing (callers omit the filter instead of searching "").
export function searchStringIds(
  db: Db,
  projectId: number,
  query: string,
): number[] {
  const match = toMatchExpression(query);
  if (!match) return [];
  const rows = db.all<{ id: number }>(sql`
    SELECT s.id AS id
    FROM strings_fts
    JOIN strings s ON s.id = strings_fts.rowid
    WHERE strings_fts MATCH ${match}
      AND s.project_id = ${projectId}
  `);
  return rows.map((row) => row.id);
}

// Each whitespace term becomes a quoted prefix match, AND-ed together.
// Quoting neutralizes FTS5 syntax in user input.
function toMatchExpression(query: string): string | undefined {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"*`);
  return terms.length > 0 ? terms.join(" ") : undefined;
}
