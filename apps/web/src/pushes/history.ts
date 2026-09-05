import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { pushes } from "@/db/schema";

export type PushRecord = typeof pushes.$inferSelect;

// A project's pushes, newest first (§9.5).
export function pushHistory(
  db: Db,
  projectId: number,
  limit = 50,
): PushRecord[] {
  return db
    .select()
    .from(pushes)
    .where(eq(pushes.projectId, projectId))
    .orderBy(desc(pushes.at), desc(pushes.id))
    .limit(limit)
    .all();
}
