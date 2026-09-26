import { and, eq, inArray, sql } from "drizzle-orm";
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

type Entry = Snapshot["strings"][number];

// The per-string writes of a push, each prepared once: a statement
// prepared per row holds native memory SQLite does not return (#604).
function stringWrites(
  tx: Db,
  sourceLanguage: string,
  targetLanguages: string[],
  seeds: NonNullable<Snapshot["seedTranslations"]>,
) {
  const p = (name: string) => sql`${sql.placeholder(name)}`;
  const rowId = sql.placeholder("rowId");
  const fields = {
    type: p("type"),
    metadata: p("metadata"),
    examples: p("examples"),
    file: p("file"),
    keyIsText: p("keyIsText"),
    note: p("note"),
    syntax: p("syntax"),
  };
  // An entry without metadata or examples leaves what the row holds, as
  // an update that left the field out did.
  const kept = {
    ...fields,
    metadata: sql`coalesce(${sql.placeholder("metadata")}, ${strings.metadata})`,
    examples: sql`coalesce(${sql.placeholder("examples")}, ${strings.examples})`,
    archived: false,
  };
  const params = (entry: Entry) => ({
    type: entry.type,
    metadata:
      entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
    examples:
      entry.examples === undefined ? null : JSON.stringify(entry.examples),
    file: entry.file ?? null,
    keyIsText: entry.keyIsText ? 1 : 0,
    note: entry.note ?? null,
    syntax: entryLibrary(entry),
  });
  // New strings and their rows go in batches (#600), a statement per
  // batch size prepared once; a batch's parameters stay under SQLite's
  // limit of 32,766 whatever the number of languages.
  const batch = Math.max(
    1,
    // Drizzle binds every column of a row, defaults included: six a row.
    Math.min(100, Math.floor(30000 / (6 * (1 + targetLanguages.length)))),
  );
  const stringBatch = new Map<number, ReturnType<typeof prepareStrings>>();
  const rowBatch = new Map<number, ReturnType<typeof prepareRows>>();
  function prepareStrings(n: number) {
    return tx
      .insert(strings)
      .values(
        Array.from({ length: n }, (_, k) => ({
          projectId: p("projectId"),
          stringId: p(`id${k}`),
          source: p(`source${k}`),
          ...Object.fromEntries(
            Object.keys(fields).map((name) => [name, p(`${name}${k}`)]),
          ),
          type: p(`type${k}`),
        })),
      )
      .returning({ id: strings.id, stringId: strings.stringId })
      .prepare();
  }
  function prepareRows(n: number) {
    return tx
      .insert(stringTranslations)
      .values(
        Array.from({ length: n }, (_, k) => [
          {
            stringId: p(`row${k}`),
            language: sourceLanguage,
            state: "translated" as const,
          },
          // A string this push creates takes its seeds in the insert
          // rather than in an update of every row after it.
          ...targetLanguages.map((language, i) => ({
            stringId: p(`row${k}`),
            language,
            text: p(`text${k}_${i}`),
            state: p(`state${k}_${i}`),
          })),
        ]).flat(),
      )
      .prepare();
  }
  const seeded = (entry: Entry, k: number) =>
    Object.fromEntries(
      targetLanguages.flatMap((language, i) => {
        const text = seeds[language]?.[entry.id];
        return [
          [`text${k}_${i}`, text ?? null],
          [
            `state${k}_${i}`,
            text === undefined || text === entry.source
              ? "untranslated"
              : "translated",
          ],
        ];
      }),
    );
  const refresh = tx
    .update(strings)
    .set(kept)
    .where(eq(strings.id, rowId))
    .prepare();
  const updateSource = tx
    .update(strings)
    .set({ ...kept, source: p("source") })
    .where(eq(strings.id, rowId))
    .prepare();
  const markStale = tx
    .update(stringTranslations)
    .set({ stale: true })
    .where(
      and(
        eq(stringTranslations.stringId, rowId),
        inArray(stringTranslations.state, [...STALE_STATES]),
      ),
    )
    .prepare();
  const resetSourceRow = tx
    .update(stringTranslations)
    .set({ state: "translated", stale: false })
    .where(
      and(
        eq(stringTranslations.stringId, rowId),
        eq(stringTranslations.language, sourceLanguage),
      ),
    )
    .prepare();
  return {
    insert(projectId: number, entries: Entry[]) {
      for (let at = 0; at < entries.length; at += batch) {
        const chunk = entries.slice(at, at + batch);
        const n = chunk.length;
        if (!stringBatch.has(n)) stringBatch.set(n, prepareStrings(n));
        if (!rowBatch.has(n)) rowBatch.set(n, prepareRows(n));
        const values: Record<string, unknown> = { projectId };
        chunk.forEach((entry, k) => {
          values[`id${k}`] = entry.id;
          values[`source${k}`] = entry.source;
          for (const [name, value] of Object.entries(params(entry)))
            values[`${name}${k}`] = value;
        });
        const ids = new Map(
          stringBatch
            .get(n)!
            .all(values)
            .map((row) => [row.stringId, row.id]),
        );
        const rows: Record<string, unknown> = {};
        chunk.forEach((entry, k) => {
          rows[`row${k}`] = ids.get(entry.id);
          Object.assign(rows, seeded(entry, k));
        });
        rowBatch.get(n)!.run(rows);
      }
    },
    refresh(id: number, entry: Entry) {
      refresh.run({ ...params(entry), rowId: id });
    },
    updateSource(id: number, entry: Entry, stale: boolean) {
      updateSource.run({ ...params(entry), source: entry.source, rowId: id });
      if (stale) markStale.run({ rowId: id });
      resetSourceRow.run({ rowId: id });
    },
  };
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

      // A language added in settings before this push, or before rows
      // were created on adding one: existing strings get their rows. The
      // strings this push creates get every row in their insert, so it
      // runs first and a first push has nothing to scan.
      ensureTranslationRows(tx, projectId, targetLanguages);
      const writes = stringWrites(
        tx,
        project.sourceLanguage,
        targetLanguages,
        snapshot.seedTranslations ?? {},
      );
      writes.insert(
        projectId,
        plan.insert.map((id) => bySnapshotId.get(id)!),
      );

      for (const id of plan.refresh)
        writes.refresh(currentRowId.get(id)!, bySnapshotId.get(id)!);

      // Translated and verified targets go stale (old text kept), an
      // untranslated row has nothing to mark, and a source that was the
      // empty string marks none; the source-language row is reset to
      // translated for re-verification (§8).
      const fromEmpty = new Set(plan.fromEmpty);
      for (const id of plan.updateSource) {
        writes.updateSource(
          currentRowId.get(id)!,
          bySnapshotId.get(id)!,
          !fromEmpty.has(id),
        );
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
      const seedResult = applySeeds(
        tx,
        projectId,
        targetLanguages,
        snapshot,
        new Set(plan.insert),
      );

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
  created: Set<string>,
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
  // What a language's rows hold, read once per language: a repository
  // pushes its whole catalogue as seeds, and a push that changes nothing
  // must cost a comparison, not a write per row; one language at a time
  // keeps a 67-language project's rows out of memory at once (#604).
  const rowsOf = db
    .select({
      stringId: stringTranslations.stringId,
      text: stringTranslations.text,
      state: stringTranslations.state,
    })
    .from(stringTranslations)
    .innerJoin(strings, eq(strings.id, stringTranslations.stringId))
    .where(
      and(
        eq(strings.projectId, projectId),
        eq(stringTranslations.language, sql.placeholder("language")),
      ),
    )
    .prepare();

  const write = db
    .update(stringTranslations)
    .set({
      text: sql`${sql.placeholder("text")}`,
      state: sql`${sql.placeholder("state")}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(stringTranslations.stringId, sql.placeholder("rowId")),
        eq(stringTranslations.language, sql.placeholder("language")),
      ),
    )
    .prepare();
  for (const [language, texts] of Object.entries(seeds)) {
    const known = targetLanguages.includes(language);
    // Rows this push created hold their seeds already; a language whose
    // seeds are all theirs has nothing to compare.
    const compare =
      known && Object.keys(texts).some((stringId) => !created.has(stringId));
    const current = new Map(
      compare ? rowsOf.all({ language }).map((row) => [row.stringId, row]) : [],
    );
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
      if (created.has(stringId)) {
        if (!identical) seeded += 1;
        continue;
      }
      // A seed the row already holds is nothing: no write, no count, and
      // the editor's "changed since you opened it" stays quiet.
      const row = current.get(rowId);
      if (row && row.text === text && row.state === state) continue;
      const { changes } = write.run({ text, state, rowId, language });
      if (!identical) seeded += changes;
    }
  }
  return { seeded, seedsIgnored, seedsIdentical };
}
