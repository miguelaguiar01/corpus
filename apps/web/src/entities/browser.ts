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

export type EntityFilter = { type?: string; q?: string };

// Diacritics do not count when searching names, as in the catalogue.
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// The browser at hundreds of entities (§9.4): one type at a time, or
// the names that contain the query, across the groups.
export function filterGroups(
  groups: EntityGroup[],
  filter: EntityFilter,
): EntityGroup[] {
  const q = filter.q?.trim() ? fold(filter.q.trim()) : undefined;
  return groups
    .filter((group) => !filter.type || group.type === filter.type)
    .map((group) =>
      q === undefined
        ? group
        : {
            ...group,
            entities: group.entities.filter((e) => fold(e.name).includes(q)),
          },
    )
    .filter((group) => group.entities.length > 0);
}

export function typeCounts(
  groups: EntityGroup[],
): { type: string; label: string; count: number }[] {
  return groups.map((g) => ({
    type: g.type,
    label: g.label,
    count: g.entities.length,
  }));
}
