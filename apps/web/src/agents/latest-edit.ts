// Which string × language rows an agent actor last edited (§10, §11):
// the draft rule tests it, and the agent drafts queue is made of it.
import { and, eq, inArray, max } from "drizzle-orm";
import type { Db } from "@/db";
import { edits, users } from "@/db/schema";

export function rowKey(stringId: number, language: string): string {
  return `${stringId} ${language}`;
}

// Rows whose latest edit was an agent's, as rowKey values. A seeded row
// has no edit, so it is never here; a push's carried family is, where
// an agent made every form (#1063).
export function agentEditedRows(db: Db): Set<string> {
  const latest = db
    .select({ id: max(edits.id) })
    .from(edits)
    .groupBy(edits.stringId, edits.language);
  const rows = db
    .select({ stringId: edits.stringId, language: edits.language })
    .from(edits)
    .innerJoin(users, eq(users.id, edits.userId))
    .where(and(eq(users.agent, true), inArray(edits.id, latest)))
    .all();
  return new Set(rows.map((r) => rowKey(r.stringId, r.language)));
}
