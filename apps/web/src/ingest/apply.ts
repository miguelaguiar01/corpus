import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  libraryOf,
  sameMessage,
  validateTranslation,
  type Library,
  type Snapshot,
  richTextFor,
  type TextReading,
  isFluentTermId,
} from "@corpus/contract";
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
import { ensureTranslationRows, dropUntakenRows } from "@/translations/rows";
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

// A seed that fails validation is kept, marked, and listed in the
// Invalid queue rather than counted as done (#646); a missing plural
// category is only incomplete. Text free of every library's syntax
// characters always validates, and a first push can hold half a million
// seeds, as does a text that is its source (#923), whichever push
// writes it.
const PLAIN = /^[^{}<>%$@|'"#&\\[\]]*$/;
function seedInvalid(
  source: string,
  text: string,
  language: string,
  library: Library,
  richText: TextReading | undefined,
  passed: string[] | undefined,
  id: string,
  sourceLanguage: string,
  placeholders?: Library[] | null,
  // The file's own plural forms for the language, an `=N` among them
  // being the file's (#982, #1051).
  pluralForms?: readonly string[] | null,
  // The exact keys one of its forms is read by (#1060).
  pluralShared?: readonly string[][] | null,
): boolean {
  if (text === source || (PLAIN.test(source) && PLAIN.test(text))) return false;
  return !validateTranslation(source, text, language, library, {
    richText,
    ...(passed && { arguments: passed }),
    ...(placeholders && { placeholders }),
    ...(pluralForms && { pluralForms }),
    ...(pluralShared && { pluralShared }),
    ...(library === "fluent" && isFluentTermId(id) && { term: true }),
    sourceLanguage,
  }).ok;
}

// The per-string writes of a push, each prepared once: a statement
// prepared per row holds native memory SQLite does not return (#604).
function stringWrites(
  tx: Db,
  sourceLanguage: string,
  targetLanguages: string[],
  seeds: NonNullable<Snapshot["seedTranslations"]>,
  richText: NonNullable<Snapshot["richText"]>,
  counts: (language: string, id: string) => boolean,
) {
  const p = (name: string) => sql`${sql.placeholder(name)}`;
  const rowId = sql.placeholder("rowId");
  const fields = {
    type: p("type"),
    metadata: p("metadata"),
    examples: p("examples"),
    file: p("file"),
    keyIsText: p("keyIsText"),
    arguments: p("arguments"),
    pluralForms: p("pluralForms"),
    pluralShared: p("pluralShared"),
    pluralRules: p("pluralRules"),
    languages: p("languages"),
    generated: p("generated"),
    placeholders: p("placeholders"),
    note: p("note"),
    syntax: p("syntax"),
  };
  // An entry without metadata leaves what the row holds, as an update
  // that left the field out did. Examples are the push's, as the text
  // is: one without them clears the old, whose slots the text may no
  // longer have (#788).
  const kept = {
    ...fields,
    metadata: sql`coalesce(${sql.placeholder("metadata")}, ${strings.metadata})`,
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
    // What the push says, as keyIsText: a push without it clears it.
    arguments: entry.arguments ? JSON.stringify(entry.arguments) : null,
    pluralForms: entry.pluralForms ? JSON.stringify(entry.pluralForms) : null,
    pluralShared: entry.pluralShared
      ? JSON.stringify(entry.pluralShared)
      : null,
    pluralRules: entry.pluralRules ?? null,
    // Stored with the source language, which every string takes.
    languages: entry.languages
      ? JSON.stringify([
          sourceLanguage,
          ...entry.languages.filter((l) => l !== sourceLanguage),
        ])
      : null,
    generated: entry.generated ?? null,
    placeholders: entry.placeholders
      ? JSON.stringify(entry.placeholders)
      : null,
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
          // Spelled out as well, so the insert's type sees the column it
          // requires.
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
        // A language outside the string's own takes no seed (#1006): its
        // row goes once the batch is in.
        const texts = takes(entry, language) ? seeds[language] : undefined;
        const text =
          texts && Object.hasOwn(texts, entry.id) ? texts[entry.id] : undefined;
        const translated =
          text !== undefined &&
          (!sameMessage(entry.source, text, libraryOf(entry)) ||
            counts(language, entry.id));
        return [
          [`text${k}_${i}`, text ?? null],
          [`state${k}_${i}`, translated ? "translated" : "untranslated"],
        ];
      }),
    );
  // The few seeds that fail validation are marked after their batch, so
  // the insert binds nothing more for the many that pass (#646).
  const markInvalid = tx
    .update(stringTranslations)
    .set({ invalid: true })
    .where(
      and(
        eq(stringTranslations.stringId, rowId),
        eq(stringTranslations.language, sql.placeholder("language")),
      ),
    )
    .prepare();
  const invalidSeeds = (entry: Entry) =>
    targetLanguages.filter((language) => {
      if (!takes(entry, language)) return false;
      const texts = seeds[language];
      if (!texts || !Object.hasOwn(texts, entry.id)) return false;
      const text = texts[entry.id]!;
      return seedInvalid(
        entry.source,
        text,
        language,
        libraryOf(entry),
        richTextFor(entry.type, entry.id, libraryOf(entry), richText),
        entry.arguments,
        entry.id,
        sourceLanguage,
        entry.placeholders,
        entry.pluralForms?.[language],
        entry.pluralShared?.[language],
      );
    });
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
        for (const entry of chunk)
          for (const language of invalidSeeds(entry))
            markInvalid.run({ rowId: ids.get(entry.id), language });
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

// Whether an entry takes a target language (#1006).
const takes = (entry: Entry, language: string) =>
  !entry.languages || entry.languages.includes(language);

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
          ...(snapshot.sourceVariants && {
            sourceVariants: snapshot.sourceVariants.filter((language) =>
              targetLanguages.includes(language),
            ),
          }),
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

      const bySnapshotId = new Map(snapshot.strings.map((s) => [s.id, s]));
      // A hidden row goes stale too, but the count is of the rows the
      // string takes once this push lands (#1006).
      const current = loadCurrent(tx, projectId, project.sourceLanguage).map(
        (c) => {
          const entry = bySnapshotId.get(c.stringId);
          return entry
            ? {
                ...c,
                translatedTargets: c.translatedTargets.filter((l) =>
                  takes(entry, l),
                ),
              }
            : c;
        },
      );
      const plan = diffSnapshot(
        { sourceLanguage: project.sourceLanguage, targetLanguages },
        current,
        snapshot.strings.map((s) => ({ id: s.id, source: s.source })),
      );
      const currentRowId = new Map(current.map((c) => [c.stringId, c.rowId]));

      // What the project reads as HTML once this push lands.
      const richText = snapshot.richText ?? project.richText ?? {};
      // A seed identical to the source counts as translated in a variant
      // of the source, or where the repository marks it so (#658).
      const variants = new Set(
        snapshot.sourceVariants ?? project.sourceVariants ?? [],
      );
      const marked = new Map(
        Object.entries(snapshot.seedTranslated ?? {}).map(([lang, ids]) => [
          lang,
          new Set(ids),
        ]),
      );
      const counts = (language: string, id: string) =>
        variants.has(language) || (marked.get(language)?.has(id) ?? false);
      const writes = stringWrites(
        tx,
        project.sourceLanguage,
        targetLanguages,
        snapshot.seedTranslations ?? {},
        richText,
        counts,
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

      // A language added in settings before this push, or before rows
      // were created on adding one, and one a string's languages gained
      // (#1006): existing strings get their rows, after the refresh has
      // set what each takes. The strings this push creates get every row
      // in their insert, so it runs first and a first push has nothing
      // to scan.
      ensureTranslationRows(tx, projectId, targetLanguages);
      writes.insert(
        projectId,
        plan.insert.map((id) => bySnapshotId.get(id)!),
      );
      dropUntakenRows(tx, projectId);

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
      // The project's strings once the inserts are in, read at most once
      // for the seeds and the suggestions both.
      let projectRows: ProjectString[] | undefined;
      const rows = () => (projectRows ??= projectStrings(tx, projectId));
      const seedResult = applySeeds(
        tx,
        projectId,
        targetLanguages,
        snapshot,
        richText,
        counts,
        new Set(plan.insert),
        rows,
      );
      applySuggestions(tx, projectId, targetLanguages, snapshot, rows);
      remarkSeeds(
        tx,
        project.sourceLanguage,
        targetLanguages,
        [
          ...recheckedSeeds(current, bySnapshotId, plan.updateSource, {
            before: project.richText ?? {},
            after: richText,
          }),
        ].map((id) => currentRowId.get(id)!),
        richText,
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
): (CurrentString & {
  rowId: number;
  type: string;
  syntax: Library | null;
  arguments: string[] | null;
  placeholders: Library[] | null;
})[] {
  const rows = db
    .select()
    .from(strings)
    .where(eq(strings.projectId, projectId))
    .all();
  // This project's translated targets alone, not the instance's (#858).
  const translations = db
    .select({
      stringId: stringTranslations.stringId,
      language: stringTranslations.language,
    })
    .from(stringTranslations)
    .innerJoin(strings, eq(strings.id, stringTranslations.stringId))
    .where(
      and(
        eq(strings.projectId, projectId),
        ne(stringTranslations.language, sourceLanguage),
        inArray(stringTranslations.state, [...STALE_STATES]),
      ),
    )
    .all();
  const targetsByString = new Map<number, string[]>();
  for (const t of translations) {
    const list = targetsByString.get(t.stringId) ?? [];
    list.push(t.language);
    targetsByString.set(t.stringId, list);
  }
  return rows.map((row) => ({
    rowId: row.id,
    stringId: row.stringId,
    source: row.source,
    archived: row.archived,
    type: row.type,
    syntax: row.syntax,
    arguments: row.arguments,
    placeholders: row.placeholders,
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

// The clear of a project's suggestions every push runs: through the
// partial index on the rows that hold one (#810), not every row.
export function suggestionClear(db: Db, projectId: number) {
  const ofProject = db
    .select({ id: strings.id })
    .from(strings)
    .where(eq(strings.projectId, projectId));
  return db
    .update(stringTranslations)
    .set({ suggestion: null })
    .where(
      and(
        isNotNull(stringTranslations.suggestion),
        inArray(stringTranslations.stringId, ofProject),
      ),
    );
}

type ProjectString = ReturnType<typeof projectStrings>[number];

function projectStrings(db: Db, projectId: number) {
  return db
    .select({
      id: strings.id,
      stringId: strings.stringId,
      source: strings.source,
      type: strings.type,
      syntax: strings.syntax,
      arguments: strings.arguments,
      languages: strings.languages,
      placeholders: strings.placeholders,
      pluralForms: strings.pluralForms,
      pluralShared: strings.pluralShared,
    })
    .from(strings)
    .where(eq(strings.projectId, projectId))
    .all();
}

// seedSuggestions (§8, #773): what the repository offers a translator to
// start from, a gettext fuzzy row. Each push replaces them whole, a push
// without them clearing them; they never touch a row's text or state.
// An id or a language the project lacks is skipped.
function applySuggestions(
  db: Db,
  projectId: number,
  targetLanguages: string[],
  snapshot: Snapshot,
  rows: () => ProjectString[],
): void {
  suggestionClear(db, projectId).run();
  const suggestions = snapshot.seedSuggestions ?? {};
  if (Object.keys(suggestions).length === 0) return;
  const rowOf = new Map(rows().map((row) => [row.stringId, row.id]));
  const set = db
    .update(stringTranslations)
    .set({ suggestion: sql`${sql.placeholder("text")}` })
    .where(
      and(
        eq(stringTranslations.stringId, sql.placeholder("row")),
        eq(stringTranslations.language, sql.placeholder("language")),
      ),
    )
    .prepare();
  for (const language of targetLanguages)
    for (const [id, text] of Object.entries(suggestions[language] ?? {})) {
      const row = rowOf.get(id);
      if (row !== undefined) set.run({ text, row, language });
    }
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
  richText: NonNullable<Snapshot["richText"]>,
  counts: (language: string, id: string) => boolean,
  created: Set<string>,
  rows: () => ProjectString[],
): { seeded: number; seedsIgnored: number; seedsIdentical: number } {
  const seeds = snapshot.seedTranslations ?? {};
  let seeded = 0;
  let seedsIgnored = 0;
  let seedsIdentical = 0;
  // No seeds, nothing to compare: a push whose every language's digest
  // the server held (#601) skips the read of the project's rows.
  if (Object.keys(seeds).length === 0)
    return { seeded: 0, seedsIgnored: 0, seedsIdentical: 0 };
  const byStringId = new Map(rows().map((row) => [row.stringId, row]));
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
      invalid: stringTranslations.invalid,
      stale: stringTranslations.stale,
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
      invalid: sql`${sql.placeholder("invalid")}`,
      // An untranslated row has nothing to be stale (#620, #934).
      stale: sql`case when ${sql.placeholder("state")} = 'untranslated' then 0 else ${stringTranslations.stale} end`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(stringTranslations.stringId, sql.placeholder("rowId")),
        eq(stringTranslations.language, sql.placeholder("language")),
      ),
    )
    .prepare();
  const mark = db
    .update(stringTranslations)
    .set({ invalid: sql`${sql.placeholder("invalid")}` })
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
        (string.languages !== null && !string.languages.includes(language)) ||
        edited.has(rowKey(string.id, language))
      ) {
        seedsIgnored += 1;
        continue;
      }
      const rowId = string.id;
      // A seed that is the source restructured, as a TMS fills a target
      // file, is the source's text too (#1009).
      const identical =
        sameMessage(string.source, text, string.syntax ?? "icu") &&
        !counts(language, stringId);
      if (identical) seedsIdentical += 1;
      const state = identical ? "untranslated" : "translated";
      if (created.has(stringId)) {
        if (!identical) seeded += 1;
        continue;
      }
      const invalid =
        !identical &&
        seedInvalid(
          string.source,
          text,
          language,
          string.syntax ?? "icu",
          richTextFor(string.type, stringId, string.syntax ?? "icu", richText),
          string.arguments ?? undefined,
          stringId,
          snapshot.sourceLanguage,
          string.placeholders,
          string.pluralForms?.[language],
          string.pluralShared?.[language],
        );
      // A seed the row already holds is nothing: no write, no count, and
      // the editor's "changed since you opened it" stays quiet. Its mark
      // follows the source it is read against now.
      const row = current.get(rowId);
      if (
        row &&
        row.text === text &&
        row.state === state &&
        !(state === "untranslated" && row.stale)
      ) {
        if (row.invalid !== invalid)
          mark.run({ rowId, language, invalid: invalid ? 1 : 0 });
        continue;
      }
      const { changes } = write.run({
        text,
        state,
        rowId,
        language,
        invalid: invalid ? 1 : 0,
      });
      if (!identical) seeded += changes;
    }
  }
  return { seeded, seedsIgnored, seedsIdentical };
}

// The strings whose unedited seeds a push re-checks (#857, #891): those
// whose source changed, and those whose library, arguments or type's
// richText changed, which a seed is validated against too, though the
// seed digest (#601) leaves their seeds out of the push.
function recheckedSeeds(
  current: {
    stringId: string;
    type: string;
    syntax: Library | null;
    arguments: string[] | null;
    placeholders: Library[] | null;
  }[],
  bySnapshotId: Map<string, Entry>,
  sourceChanged: string[],
  richText: {
    before: NonNullable<Snapshot["richText"]>;
    after: NonNullable<Snapshot["richText"]>;
  },
): Set<string> {
  const out = new Set(sourceChanged);
  for (const was of current) {
    const entry = bySnapshotId.get(was.stringId);
    if (!entry) continue;
    if (
      entryLibrary(entry) !== was.syntax ||
      JSON.stringify(entry.arguments ?? null) !==
        JSON.stringify(was.arguments) ||
      JSON.stringify(entry.placeholders ?? null) !==
        JSON.stringify(was.placeholders) ||
      richText.after[entry.type] !== richText.before[was.type]
    )
      out.add(was.stringId);
  }
  return out;
}

// A push that changes a source leaves the unchanged seeds out (#601),
// so the repository's translations of it are checked here (#857). A row
// a translator saved is theirs, and a save clears the mark; a verify
// changes no text and does not make it theirs.
function remarkSeeds(
  db: Db,
  sourceLanguage: string,
  targetLanguages: string[],
  rowIds: number[],
  richText: NonNullable<Snapshot["richText"]>,
): void {
  const mark = db
    .update(stringTranslations)
    .set({ invalid: sql`${sql.placeholder("invalid")}` })
    .where(
      and(
        eq(stringTranslations.stringId, sql.placeholder("rowId")),
        eq(stringTranslations.language, sql.placeholder("language")),
      ),
    )
    .prepare();
  for (let at = 0; at < rowIds.length; at += 500) {
    const ids = rowIds.slice(at, at + 500);
    const edited = new Set(
      db
        .select({ stringId: edits.stringId, language: edits.language })
        .from(edits)
        .where(
          and(inArray(edits.stringId, ids), ne(edits.newState, "verified")),
        )
        .all()
        .map((e) => `${e.stringId}\u0000${e.language}`),
    );
    const rows = db
      .select({
        rowId: stringTranslations.stringId,
        language: stringTranslations.language,
        text: stringTranslations.text,
        state: stringTranslations.state,
        invalid: stringTranslations.invalid,
        source: strings.source,
        type: strings.type,
        key: strings.stringId,
        syntax: strings.syntax,
        arguments: strings.arguments,
        placeholders: strings.placeholders,
        pluralForms: strings.pluralForms,
        pluralShared: strings.pluralShared,
      })
      .from(stringTranslations)
      .innerJoin(strings, eq(strings.id, stringTranslations.stringId))
      .where(
        and(
          inArray(stringTranslations.stringId, ids),
          inArray(stringTranslations.language, targetLanguages),
          isNotNull(stringTranslations.text),
        ),
      )
      .all();
    for (const row of rows) {
      if (row.state === "untranslated") continue;
      if (edited.has(`${row.rowId}\u0000${row.language}`)) continue;
      const invalid = seedInvalid(
        row.source,
        row.text!,
        row.language,
        row.syntax ?? "icu",
        richTextFor(row.type, row.key, row.syntax ?? "icu", richText),
        row.arguments ?? undefined,
        row.key,
        sourceLanguage,
        row.placeholders,
        row.pluralForms?.[row.language],
        row.pluralShared?.[row.language],
      );
      if (invalid !== row.invalid)
        mark.run({
          rowId: row.rowId,
          language: row.language,
          invalid: invalid ? 1 : 0,
        });
    }
  }
}
