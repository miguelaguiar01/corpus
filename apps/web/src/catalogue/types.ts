import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { strings } from "@/db/schema";

export function distinctTypes(db: Db, projectId: number): string[] {
  return db
    .selectDistinct({ type: strings.type })
    .from(strings)
    .where(eq(strings.projectId, projectId))
    .orderBy(sql`${strings.type}`)
    .all()
    .map((row) => row.type);
}
