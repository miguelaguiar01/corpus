import { and, eq, inArray } from "drizzle-orm";
import type { Snapshot } from "@corpus/contract";
import type { Db } from "@/db";
import { entities, projects, strings, stringTranslations } from "@/db/schema";
import { diffSnapshot, type CurrentString, type DiffReport } from "./diff";

export type IngestReport = DiffReport & {
  entitiesUpserted: number;
  entitiesRemoved: number;
};

// Carries the computed report out of a dry-run transaction while forcing
// the rollback (§8: same diff, rolled back, so the numbers are exact).
class DryRunRollback extends Error {
  constructor(readonly report: IngestReport) {
    super("dry-run rollback");
  }
}

// Apply a validated snapshot to a project in one transaction (§8). The
// whole thing rolls back if any step throws, so a push is all-or-nothing.
// dryRun applies then rolls back, returning the exact report.
export function applySnapshot(
  db: Db,
  projectId: number,
  snapshot: Snapshot,
  options: { dryRun?: boolean } = {},
): IngestReport {
  try {
    return db.transaction((tx) => {
      const project = tx
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .get();
      if (!project) throw new Error(`project ${projectId} not found`);

      const targetLanguages = project.languages.filter(
        (lang) => lang !== project.sourceLanguage,
      );

      // Refresh the declarations so the catalogue's facets stay in sync
      // with what the client declared (§5).
      tx.update(projects)
        .set({
          stringTypes: snapshot.stringTypes ?? null,
          entityTypes: snapshot.entityTypes ?? null,
        })
        .where(eq(projects.id, projectId))
        .run();

      const current = loadCurrent(tx, projectId, project.sourceLanguage);
      const plan = diffSnapshot(
        { sourceLanguage: project.sourceLanguage, targetLanguages },
        current,
        snapshot.strings.map((s) => ({ id: s.id, source: s.source })),
      );
      const bySnapshotId = new Map(snapshot.strings.map((s) => [s.id, s]));
      const currentRowId = new Map(current.map((c) => [c.stringId, c.rowId]));

      for (const id of plan.insert) {
        const entry = bySnapshotId.get(id)!;
        const row = tx
          .insert(strings)
          .values({
            projectId,
            stringId: entry.id,
            type: entry.type,
            source: entry.source,
            metadata: entry.metadata,
            examples: entry.examples,
          })
          .returning()
          .get();
        tx.insert(stringTranslations)
          .values([
            {
              stringId: row.id,
              language: project.sourceLanguage,
              state: "translated",
            },
            ...targetLanguages.map((language) => ({
              stringId: row.id,
              language,
              state: "untranslated" as const,
            })),
          ])
          .run();
      }

      for (const id of plan.refresh) {
        const entry = bySnapshotId.get(id)!;
        tx.update(strings)
          .set({
            type: entry.type,
            metadata: entry.metadata,
            examples: entry.examples,
            archived: false,
          })
          .where(eq(strings.id, currentRowId.get(id)!))
          .run();
      }

      for (const id of plan.updateSource) {
        const entry = bySnapshotId.get(id)!;
        const rowId = currentRowId.get(id)!;
        tx.update(strings)
          .set({
            type: entry.type,
            source: entry.source,
            metadata: entry.metadata,
            examples: entry.examples,
            archived: false,
          })
          .where(eq(strings.id, rowId))
          .run();
        // Targets go stale (old text kept); the source-language row is reset
        // to translated for re-verification (§8).
        tx.update(stringTranslations)
          .set({ stale: true })
          .where(eq(stringTranslations.stringId, rowId))
          .run();
        tx.update(stringTranslations)
          .set({ state: "translated", stale: false })
          .where(
            and(
              eq(stringTranslations.stringId, rowId),
              eq(stringTranslations.language, project.sourceLanguage),
            ),
          )
          .run();
      }

      if (plan.archive.length > 0) {
        tx.update(strings)
          .set({ archived: true })
          .where(
            inArray(
              strings.id,
              plan.archive.map((id) => currentRowId.get(id)!),
            ),
          )
          .run();
      }

      const entityResult = applyEntities(tx, projectId, snapshot);

      const report = { ...plan.report, ...entityResult };
      if (options.dryRun) throw new DryRunRollback(report);
      return report;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.report;
    throw error;
  }
}

function loadCurrent(
  db: Db,
  projectId: number,
  sourceLanguage: string,
): (CurrentString & { rowId: number })[] {
  const rows = db
    .select()
    .from(strings)
    .where(eq(strings.projectId, projectId))
    .all();
  const translations = db
    .select({
      stringId: stringTranslations.stringId,
      language: stringTranslations.language,
    })
    .from(stringTranslations)
    .all();
  const targetsByString = new Map<number, string[]>();
  for (const t of translations) {
    if (t.language === sourceLanguage) continue;
    const list = targetsByString.get(t.stringId) ?? [];
    list.push(t.language);
    targetsByString.set(t.stringId, list);
  }
  return rows.map((row) => ({
    rowId: row.id,
    stringId: row.stringId,
    source: row.source,
    archived: row.archived,
    targetLanguages: targetsByString.get(row.id) ?? [],
  }));
}

function applyEntities(
  db: Db,
  projectId: number,
  snapshot: Snapshot,
): { entitiesUpserted: number; entitiesRemoved: number } {
  const existing = db
    .select()
    .from(entities)
    .where(eq(entities.projectId, projectId))
    .all();
  const existingById = new Map(existing.map((e) => [e.entityId, e]));
  const snapshotIds = new Set(snapshot.entities.map((e) => e.id));

  for (const entity of snapshot.entities) {
    const prev = existingById.get(entity.id);
    if (prev) {
      db.update(entities)
        .set({
          type: entity.type,
          name: entity.name,
          attributes: entity.attributes,
        })
        .where(eq(entities.id, prev.id))
        .run();
    } else {
      db.insert(entities)
        .values({
          projectId,
          entityId: entity.id,
          type: entity.type,
          name: entity.name,
          attributes: entity.attributes,
        })
        .run();
    }
  }

  const removed = existing.filter((e) => !snapshotIds.has(e.entityId));
  if (removed.length > 0) {
    db.delete(entities)
      .where(
        inArray(
          entities.id,
          removed.map((e) => e.id),
        ),
      )
      .run();
  }

  return {
    entitiesUpserted: snapshot.entities.length,
    entitiesRemoved: removed.length,
  };
}
