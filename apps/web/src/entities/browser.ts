// The entity browser (§9.4): every entity of a project grouped by type,
// read-only, with the declared type label (§6) when the project has one.
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { entities, projects } from "@/db/schema";
import type { EntityCard } from "@/strings/detail";

export type EntityGroup = {
  type: string;
  label: string;
  entities: EntityCard[];
};

export function entitiesByType(db: Db, projectId: number): EntityGroup[] {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  const labels = project?.entityTypes ?? {};
  const rows = db
    .select()
    .from(entities)
    .where(eq(entities.projectId, projectId))
    .orderBy(asc(entities.type), asc(entities.name))
    .all();
  const groups = new Map<string, EntityGroup>();
  for (const row of rows) {
    const label = labels[row.type]?.label ?? row.type;
    const group = groups.get(row.type) ?? {
      type: row.type,
      label,
      entities: [],
    };
    group.entities.push({
      entityId: row.entityId,
      type: row.type,
      typeLabel: label,
      name: row.name,
      attributes: row.attributes ?? null,
    });
    groups.set(row.type, group);
  }
  return [...groups.values()];
}
