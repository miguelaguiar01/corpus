import { and, eq, inArray } from "drizzle-orm";
import { libraryOf, type Library, type Snapshot } from "@corpus/contract";
import type { Db } from "@/db";
import {
  edits,
  entities,
  projects,
  pushes,
  strings,
  stringTranslations,
} from "@/db/schema";
import { reconcileProposals } from "@/proposals/service";
import { ensureTranslationRows } from "@/translations/rows";
import {
  diffSnapshot,
  STALE_STATES,
  type CurrentString,
  type DiffReport,
} from "./diff";

export type IngestReport = DiffReport & {
  entitiesUpserted: number;
  entitiesRemoved: number;
  seeded: number;
  seedsIgnored: number;
  seedsIdentical: number;
  proposalsApplied: number;
  proposalsSuperseded: number;
};

// Carries the computed report out of a dry-run transaction while forcing
// the rollback (§8: same diff, rolled back, so the numbers are exact).
class DryRunRollback extends Error {
  constructor(readonly report: IngestReport) {
    super("dry-run rollback");
  }
}

// The column holds the library the string is written for; a push may
// name it as `library` or, until 1.0, as the old `syntax` (§4). Plain
// ICU is null, as it has been since the column existed.
function entryLibrary(entry: Snapshot["strings"][number]): Library | null {
  const library = libraryOf(entry);
  return library === "icu" ? null : library;
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
          sources: snapshot.sources ?? null,
          ...(snapshot.typeNotes && { typeNotes: snapshot.typeNotes }),
          ...(snapshot.richText && { richText: snapshot.richText }),
          ...(snapshot.glossary && { glossary: snapshot.glossary }),
          // The languages this push digested replace their entries; the
          // rest stay, as a push carries digests for every target
          // language it knows (#601). A language the project does not
          // have is not stored: its seeds were ignored, and a digest
          // kept for it would skip them once the language is added.
          ...(snapshot.seedDigests && {
            seedDigests: {
              ...(project.seedDigests ?? {}),
              ...Object.fromEntries(
                Object.entries(snapshot.seedDigests).filter(([language]) =>
                  targetLanguages.includes(language),
                ),
              ),
            },
          }),
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
            file: entry.file ?? null,
            keyIsText: entry.keyIsText ?? false,
            note: entry.note ?? null,
            syntax: entryLibrary(entry),
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

      // A language added in settings before this push, or before rows
      // were created on adding one: existing strings get their rows.
      ensureTranslationRows(tx, projectId, targetLanguages);

      for (const id of plan.refresh) {
        const entry = bySnapshotId.get(id)!;
        tx.update(strings)
          .set({
            type: entry.type,
            metadata: entry.metadata,
            examples: entry.examples,
            file: entry.file ?? null,
            keyIsText: entry.keyIsText ?? false,
            note: entry.note ?? null,
            syntax: entryLibrary(entry),
            archived: false,
          })
          .where(eq(strings.id, currentRowId.get(id)!))
          .run();
      }

      const fromEmpty = new Set(plan.fromEmpty);
      for (const id of plan.updateSource) {
        const entry = bySnapshotId.get(id)!;
        const rowId = currentRowId.get(id)!;
        tx.update(strings)
          .set({
            type: entry.type,
            source: entry.source,
            metadata: entry.metadata,
            examples: entry.examples,
            file: entry.file ?? null,
            keyIsText: entry.keyIsText ?? false,
            note: entry.note ?? null,
            syntax: entryLibrary(entry),
            archived: false,
          })
          .where(eq(strings.id, rowId))
          .run();
        // Translated and verified targets go stale (old text kept), an
        // untranslated row has nothing to mark, and a source that was the
        // empty string marks none; the source-language row is reset to
        // translated for re-verification (§8).
        if (!fromEmpty.has(id)) {
          tx.update(stringTranslations)
            .set({ stale: true })
            .where(
              and(
                eq(stringTranslations.stringId, rowId),
                inArray(stringTranslations.state, [...STALE_STATES]),
              ),
            )
            .run();
        }
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
      const seedResult = applySeeds(tx, projectId, targetLanguages, snapshot);

      // Proposals that this push lands or overtakes (§8, §11).
      const proposals = reconcileProposals(
        tx,
        projectId,
        new Map(current.map((c) => [c.stringId, c.source])),
        new Map(snapshot.strings.map((s) => [s.id, s.source])),
      );
      const report = {
        ...plan.report,
        ...entityResult,
        ...seedResult,
        proposalsApplied: proposals.applied,
        proposalsSuperseded: proposals.superseded,
      };
      if (options.dryRun) throw new DryRunRollback(report);
      tx.insert(pushes)
        .values({
          projectId,
          stringCount: snapshot.strings.length,
          added: report.added,
          changed: report.changed,
          stale: report.stale,
          archived: report.archived,
          unarchived: report.unarchived,
          seeded: report.seeded,
        })
        .run();
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
      state: stringTranslations.state,
    })
    .from(stringTranslations)
    .all();
  const targetsByString = new Map<number, string[]>();
  for (const t of translations) {
    if (t.language === sourceLanguage) continue;
    if (!(STALE_STATES as readonly string[]).includes(t.state)) continue;
    const list = targetsByString.get(t.stringId) ?? [];
    list.push(t.language);
    targetsByString.set(t.stringId, list);
  }
  return rows.map((row) => ({
    rowId: row.id,
    stringId: row.stringId,
    source: row.source,
    archived: row.archived,
    translatedTargets: targetsByString.get(row.id) ?? [],
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

// seedTranslations (§8): a repo's existing target catalogs import as
// `translated`, but only where Corpus has no edit history for the
// string×language — after the first edit, Corpus wins. A seed equal to
// the source text is an exporter's filler for a missing translation:
// the text is kept for the round trip, the row stays `untranslated`.
// Unknown ids, unknown
// languages, and the source language are skipped and counted, never
// errors. Runs after the string writes so the rows exist.
function applySeeds(
  db: Db,
  projectId: number,
  targetLanguages: string[],
  snapshot: Snapshot,
): { seeded: number; seedsIgnored: number; seedsIdentical: number } {
  const seeds = snapshot.seedTranslations ?? {};
  let seeded = 0;
  let seedsIgnored = 0;
  let seedsIdentical = 0;
  const byStringId = new Map(
    db
      .select({
        id: strings.id,
        stringId: strings.stringId,
        source: strings.source,
      })
      .from(strings)
      .where(eq(strings.projectId, projectId))
      .all()
      .map((row) => [row.stringId, row]),
  );
  // No seeds, nothing to compare: a push whose every language's digest
  // the server held (#601) skips the read of the project's rows.
  if (Object.keys(seeds).length === 0)
    return { seeded: 0, seedsIgnored: 0, seedsIdentical: 0 };
  const rowKey = (rowId: number, language: string) =>
    `${rowId}\u0000${language}`;
  const edited = new Set(
    db
      .select({ stringId: edits.stringId, language: edits.language })
      .from(edits)
      .innerJoin(strings, eq(strings.id, edits.stringId))
      .where(eq(strings.projectId, projectId))
      .all()
      .map((edit) => rowKey(edit.stringId, edit.language)),
  );
  // What every row holds, read once: a repository pushes its whole
  // catalogue as seeds on every push, and a push that changes nothing
  // must cost a comparison, not a write per row.
  const current = new Map(
    db
      .select({
        stringId: stringTranslations.stringId,
        language: stringTranslations.language,
        text: stringTranslations.text,
        state: stringTranslations.state,
      })
      .from(stringTranslations)
      .innerJoin(strings, eq(strings.id, stringTranslations.stringId))
      .where(eq(strings.projectId, projectId))
      .all()
      .map((row) => [rowKey(row.stringId, row.language), row]),
  );

  for (const [language, texts] of Object.entries(seeds)) {
    const known = targetLanguages.includes(language);
    for (const [stringId, text] of Object.entries(texts)) {
      const string = byStringId.get(stringId);
      if (
        !known ||
        string === undefined ||
        edited.has(rowKey(string.id, language))
      ) {
        seedsIgnored += 1;
        continue;
      }
      const rowId = string.id;
      const identical = text === string.source;
      if (identical) seedsIdentical += 1;
      const state = identical ? "untranslated" : "translated";
      // A seed the row already holds is nothing: no write, no count, and
      // the editor's "changed since you opened it" stays quiet.
      const row = current.get(rowKey(rowId, language));
      if (row && row.text === text && row.state === state) continue;
      const { changes } = db
        .update(stringTranslations)
        .set({ text, state, updatedAt: new Date() })
        .where(
          and(
            eq(stringTranslations.stringId, rowId),
            eq(stringTranslations.language, language),
          ),
        )
        .run();
      if (!identical) seeded += changes;
    }
  }
  return { seeded, seedsIgnored, seedsIdentical };
}
