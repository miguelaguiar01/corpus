import {
  moonlightManor,
  snapshotSchema,
  type Snapshot,
} from "@corpus/contract";
import type { Database as BetterSqlite } from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { expect, test } from "vitest";
import type { Db } from "@/db";
import {
  edits,
  entities,
  projects,
  pushes,
  strings,
  stringTranslations,
  users,
} from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applyTransition } from "@/translations/service";
import { queueItems } from "@/catalogue/queues";
import { stringDetail } from "@/strings/detail";
import { progressCounts } from "@/catalogue/progress";
import { listCatalogue } from "@/catalogue/query";
import { pullPayload } from "@/pull/payload";
import { applySnapshot, suggestionClear } from "./apply";

const FIXTURE = moonlightManor as Snapshot;

function seed(languages = ["pt-PT", "en"]) {
  const db = memoryDb();
  const [project] = db
    .insert(projects)
    .values({
      slug: "moonlight-manor",
      name: "Moonlight Manor",
      sourceLanguage: "pt-PT",
      languages,
    })
    .returning()
    .all();
  if (!project) throw new Error("seed failed");
  return { db, project };
}

function stringRow(db: Db, stringId: string) {
  return db.select().from(strings).where(eq(strings.stringId, stringId)).get();
}

test("first push inserts strings, entities, and initial translation rows", () => {
  const { db, project } = seed();
  const report = applySnapshot(db, project.id, FIXTURE);
  expect(report.added).toBe(FIXTURE.strings.length);
  expect(report.entitiesUpserted).toBe(FIXTURE.entities.length);

  const s = stringRow(db, "skin.seen-at-greenhouse-window");
  expect(s?.source).toContain("foi");
  const rows = db
    .select()
    .from(stringTranslations)
    .where(eq(stringTranslations.stringId, s!.id))
    .all();
  const source = rows.find((r) => r.language === "pt-PT");
  const target = rows.find((r) => r.language === "en");
  expect(source?.state).toBe("translated");
  expect(target?.state).toBe("untranslated");
});

test("re-pushing unchanged strings changes no states", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, FIXTURE);
  const report = applySnapshot(db, project.id, FIXTURE);
  expect(report.added).toBe(0);
  expect(report.changed).toBe(0);
  expect(report.stale).toBe(0);
});

test("changing a source stales its translated target rows and resets the source row", () => {
  const { db, project } = seed();
  applySnapshot(
    db,
    project.id,
    withSeeds({
      en: { "skin.seen-at-greenhouse-window": "Seen at the window." },
    }),
  );
  const changed = structuredClone(FIXTURE);
  changed.strings[0]!.source = "{person} apareceu.";

  const report = applySnapshot(db, project.id, changed);
  expect(report.changed).toBe(1);
  expect(report.stale).toBe(1); // one translated target row (en)

  const s = stringRow(db, "skin.seen-at-greenhouse-window");
  const rows = db
    .select()
    .from(stringTranslations)
    .where(eq(stringTranslations.stringId, s!.id))
    .all();
  expect(rows.find((r) => r.language === "en")?.stale).toBe(true);
  const source = rows.find((r) => r.language === "pt-PT");
  expect(source?.state).toBe("translated");
  expect(source?.stale).toBe(false);
});

test("a changed source marks stale the translated and verified rows only; an untranslated row is left alone (#620)", () => {
  const { db, project } = seed(["pt-PT", "en", "fr", "de"]);
  applySnapshot(db, project.id, FIXTURE);
  const s = stringRow(db, "skin.seen-at-greenhouse-window")!;
  for (const [language, state] of [
    ["fr", "translated"],
    ["de", "verified"],
  ] as const) {
    db.update(stringTranslations)
      .set({ state, text: "…" })
      .where(
        and(
          eq(stringTranslations.stringId, s.id),
          eq(stringTranslations.language, language),
        ),
      )
      .run();
  }
  const changed = structuredClone(FIXTURE);
  changed.strings[0]!.source = "{person} apareceu.";

  const report = applySnapshot(db, project.id, changed);
  expect(report.changed).toBe(1);
  expect(report.stale).toBe(2);
  const staleOf = (language: string) =>
    translationOf(db, "skin.seen-at-greenhouse-window", language)?.stale;
  expect(staleOf("en")).toBe(false);
  expect(staleOf("fr")).toBe(true);
  expect(staleOf("de")).toBe(true);
  expect(staleOf("pt-PT")).toBe(false);
});

test("a source that was the empty string takes its text with no stale mark, and the report counts it (#620)", () => {
  const { db, project } = seed();
  const empty = structuredClone(FIXTURE);
  empty.strings[0]!.source = "";
  applySnapshot(db, project.id, {
    ...empty,
    seedTranslations: {
      en: { "skin.seen-at-greenhouse-window": "Seen at the window." },
    },
  });
  expect(translationOf(db, "skin.seen-at-greenhouse-window", "en")?.state).toBe(
    "translated",
  );

  const keyed = structuredClone(FIXTURE);
  keyed.strings[0]!.source = "skin.seen-at-greenhouse-window";
  const report = applySnapshot(db, project.id, keyed);
  expect(report).toMatchObject({ changed: 1, stale: 0, fromEmpty: 1 });
  expect(stringRow(db, "skin.seen-at-greenhouse-window")?.source).toBe(
    "skin.seen-at-greenhouse-window",
  );
  expect(
    translationOf(db, "skin.seen-at-greenhouse-window", "en"),
  ).toMatchObject({
    state: "translated",
    stale: false,
    text: "Seen at the window.",
  });
});

test("a pushed entry's keyIsText is kept on the row, false when the push does not carry it (#611)", () => {
  const { db, project } = seed();
  const keyed = structuredClone(FIXTURE);
  keyed.strings[0] = {
    ...keyed.strings[0]!,
    source: keyed.strings[0]!.id,
    keyIsText: true,
  };
  applySnapshot(db, project.id, keyed);
  expect(stringRow(db, keyed.strings[0]!.id)?.keyIsText).toBe(true);
  expect(stringRow(db, keyed.strings[1]!.id)?.keyIsText).toBe(false);
  // The next push, from a CLI that does not send the field, clears it.
  applySnapshot(db, project.id, { ...keyed, strings: FIXTURE.strings });
  expect(stringRow(db, keyed.strings[0]!.id)?.keyIsText).toBe(false);
});

test("a string dropped from the snapshot is archived; entity is removed", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, FIXTURE);
  const fewer = structuredClone(FIXTURE);
  fewer.strings.pop();
  fewer.entities.pop();

  const report = applySnapshot(db, project.id, fewer);
  expect(report.archived).toBe(1);
  expect(report.entitiesRemoved).toBe(1);
  expect(stringRow(db, "ui.marks-left")?.archived).toBe(true);
});

test("an archived string returning is unarchived", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, FIXTURE);
  const fewer = structuredClone(FIXTURE);
  fewer.strings.pop();
  applySnapshot(db, project.id, fewer);
  expect(stringRow(db, "ui.marks-left")?.archived).toBe(true);

  const report = applySnapshot(db, project.id, FIXTURE);
  expect(report.unarchived).toBe(1);
  expect(stringRow(db, "ui.marks-left")?.archived).toBe(false);
});

test("a mid-apply failure rolls back the whole push (atomic, §8)", () => {
  const { db, project } = seed();
  // Poison the transaction: throw on the 3rd insert inside the tx so a
  // partial apply is attempted, then assert nothing persisted.
  const poisoned = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return (cb: (tx: unknown) => unknown) =>
          (target as Db).transaction((tx) => {
            let inserts = 0;
            const txProxy = new Proxy(tx, {
              get(t, p, r) {
                if (p === "insert") {
                  inserts += 1;
                  if (inserts === 3) throw new Error("injected failure");
                }
                return Reflect.get(t, p, r);
              },
            });
            return cb(txProxy);
          });
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Db;

  expect(() => applySnapshot(poisoned, project.id, FIXTURE)).toThrow(
    "injected failure",
  );
  expect(db.select().from(strings).all()).toHaveLength(0);
  expect(db.select().from(entities).all()).toHaveLength(0);
  expect(db.select().from(stringTranslations).all()).toHaveLength(0);
});

test("push persists the entity type labels alongside the string declarations", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, FIXTURE);
  const row = db
    .select()
    .from(projects)
    .where(eq(projects.id, project.id))
    .get();
  expect(row?.entityTypes).toEqual(FIXTURE.entityTypes);
  expect(row?.stringTypes).toEqual(FIXTURE.stringTypes);
});

function withSeeds(
  seeds: Record<string, Record<string, string>>,
  strings = FIXTURE.strings,
): Snapshot {
  return { ...FIXTURE, strings, seedTranslations: seeds };
}

function translationOf(db: Db, stringId: string, language: string) {
  const s = stringRow(db, stringId);
  if (!s) throw new Error(`no string ${stringId}`);
  return db
    .select()
    .from(stringTranslations)
    .where(
      and(
        eq(stringTranslations.stringId, s.id),
        eq(stringTranslations.language, language),
      ),
    )
    .get();
}

test("seeds are written through one prepared statement, however many there are (#604)", () => {
  const prepares = (seeds: Record<string, Record<string, string>>) => {
    const { db, project } = seed();
    applySnapshot(db, project.id, FIXTURE);
    const client = (db as unknown as { $client: BetterSqlite }).$client;
    const prepare = client.prepare.bind(client);
    let count = 0;
    client.prepare = ((source: string) => {
      count += 1;
      return prepare(source);
    }) as typeof client.prepare;
    applySnapshot(db, project.id, withSeeds(seeds));
    return count;
  };
  const one = prepares({ en: { "ui.continue": "Continue" } });
  const every = prepares({
    en: Object.fromEntries(FIXTURE.strings.map((s) => [s.id, `EN ${s.id}`])),
  });
  expect(FIXTURE.strings.length).toBeGreaterThan(2);
  expect(every).toBe(one);
});

test("a push prepares as many statements for twenty strings as for two, inserting, refreshing or changing them (#604)", () => {
  const snapshot = (n: number, prefix: string): Snapshot => ({
    ...FIXTURE,
    strings: [
      ...FIXTURE.strings,
      ...Array.from({ length: n }, (_, i) => ({
        id: `ui.extra-${i}`,
        type: "chrome",
        source: `${prefix} ${i}`,
      })),
    ],
  });
  const prepares = (n: number) => {
    const { db, project } = seed();
    const client = (db as unknown as { $client: BetterSqlite }).$client;
    const prepare = client.prepare.bind(client);
    const counts: number[] = [];
    let count = 0;
    client.prepare = ((source: string) => {
      count += 1;
      return prepare(source);
    }) as typeof client.prepare;
    for (const push of [
      snapshot(n, "One"),
      snapshot(n, "One"),
      snapshot(n, "Two"),
    ]) {
      count = 0;
      applySnapshot(db, project.id, push);
      counts.push(count);
    }
    return counts;
  };
  expect(prepares(20)).toEqual(prepares(2));
});

test("a first push that seeds the strings it creates leaves the rows and counts of creating them, then seeding them (#600)", () => {
  const seeds = {
    en: {
      "ui.continue": "Continue",
      "skin.heard-nothing": "Heard nothing.",
      [FIXTURE.strings[0]!.id]: FIXTURE.strings[0]!.source,
    },
    de: { "ui.continue": "Weiter" },
  };
  const rows = (db: Db) =>
    db
      .select({
        stringId: stringTranslations.stringId,
        language: stringTranslations.language,
        text: stringTranslations.text,
        state: stringTranslations.state,
        stale: stringTranslations.stale,
      })
      .from(stringTranslations)
      .orderBy(stringTranslations.stringId, stringTranslations.language)
      .all();
  const once = seed();
  const onceReport = applySnapshot(once.db, once.project.id, withSeeds(seeds));
  const twice = seed();
  applySnapshot(twice.db, twice.project.id, FIXTURE);
  const twiceReport = applySnapshot(
    twice.db,
    twice.project.id,
    withSeeds(seeds),
  );
  expect(rows(once.db)).toEqual(rows(twice.db));
  for (const count of ["seeded", "seedsIdentical", "seedsIgnored"] as const)
    expect(onceReport[count]).toBe(twiceReport[count]);
  expect(onceReport).toMatchObject({
    seeded: 2,
    seedsIdentical: 1,
    seedsIgnored: 1,
  });
});

test("a first push of many strings in many languages stays under SQLite's variable limit (#600)", () => {
  const languages = Array.from({ length: 120 }, (_, i) => `x${i}`);
  const { db, project } = seed(["pt-PT", ...languages]);
  const strings = Array.from({ length: 150 }, (_, i) => ({
    id: `ui.s${i}`,
    type: "chrome",
    source: `Texto ${i}`,
  }));
  const report = applySnapshot(db, project.id, {
    ...FIXTURE,
    strings: [...FIXTURE.strings, ...strings],
    seedTranslations: { x7: { "ui.s149": "Text 149" } },
  });
  expect(report.added).toBe(FIXTURE.strings.length + 150);
  expect(report.seeded).toBe(1);
  expect(translationOf(db, "ui.s149", "x7")).toMatchObject({
    state: "translated",
    text: "Text 149",
  });
  expect(translationOf(db, "ui.s148", "x119")?.state).toBe("untranslated");
});

test("a new string named like an object's own property takes no seed it does not have (#600)", () => {
  const { db, project } = seed();
  const names = ["constructor", "toString", "__proto__"];
  const report = applySnapshot(db, project.id, {
    ...FIXTURE,
    strings: [
      ...FIXTURE.strings,
      ...names.map((id) => ({ id, type: "chrome", source: `Texto ${id}` })),
    ],
    seedTranslations: { en: { "ui.continue": "Continue" } },
  });
  expect(report.seeded).toBe(1);
  for (const id of names)
    expect(translationOf(db, id, "en")).toMatchObject({
      state: "untranslated",
      text: null,
    });
});

test("a seed that fails validation is marked invalid, on the push that creates the row or a later one, and a fixed seed clears it (#646)", () => {
  const { db, project } = seed();
  const broken = {
    en: {
      "skin.seen-at-greenhouse-window": "Seen at the window.",
      "ui.continue": "Continue",
    },
  };
  applySnapshot(db, project.id, withSeeds(broken));
  expect(
    translationOf(db, "skin.seen-at-greenhouse-window", "en"),
  ).toMatchObject({
    state: "translated",
    invalid: true,
  });
  expect(translationOf(db, "ui.continue", "en")?.invalid).toBe(false);
  // A row that holds the seed already, unmarked as one from before the
  // mark existed, is marked when the seed arrives again.
  db.update(stringTranslations).set({ invalid: false }).run();
  applySnapshot(db, project.id, withSeeds(broken));
  expect(
    translationOf(db, "skin.seen-at-greenhouse-window", "en")?.invalid,
  ).toBe(true);
  // A later push writing another broken text keeps it flagged; a valid
  // text clears it.
  const fixed =
    "{person} was {person_gender, select, m {seen} f {seen}} at the window {room_de} at {hour} — and was not {person_gender, select, m {alone} f {alone}}.";
  applySnapshot(
    db,
    project.id,
    withSeeds({ en: { "skin.seen-at-greenhouse-window": fixed } }),
  );
  expect(
    translationOf(db, "skin.seen-at-greenhouse-window", "en")?.invalid,
  ).toBe(false);
  applySnapshot(
    db,
    project.id,
    withSeeds({ en: { "skin.seen-at-greenhouse-window": "Seen." } }),
  );
  expect(
    translationOf(db, "skin.seen-at-greenhouse-window", "en")?.invalid,
  ).toBe(true);
});

test("seedTranslations on a first push import as translated and are counted", () => {
  const { db, project } = seed();
  const report = applySnapshot(
    db,
    project.id,
    withSeeds({
      en: { "ui.continue": "Continue", "skin.heard-nothing": "Heard nothing." },
    }),
  );
  expect(report.seeded).toBe(2);
  expect(report.seedsIgnored).toBe(0);
  expect(translationOf(db, "ui.continue", "en")).toMatchObject({
    state: "translated",
    text: "Continue",
  });
  expect(translationOf(db, "skin.seen-at-greenhouse-window", "en")?.state).toBe(
    "untranslated",
  );
});

test("a seed equal to the source keeps its text as untranslated, is counted apart, and a re-push is a no-op", () => {
  const { db, project } = seed();
  const same = FIXTURE.strings.find((s) => s.id === "ui.continue")!.source;
  const seeds = withSeeds({
    en: { "ui.continue": same, "skin.heard-nothing": "Heard nothing." },
  });
  const report = applySnapshot(db, project.id, seeds);
  expect(report.seeded).toBe(1);
  expect(report.seedsIdentical).toBe(1);
  expect(report.seedsIgnored).toBe(0);
  expect(translationOf(db, "ui.continue", "en")).toMatchObject({
    state: "untranslated",
    text: same,
  });
  expect(translationOf(db, "skin.heard-nothing", "en")).toMatchObject({
    state: "translated",
    text: "Heard nothing.",
  });
  const before = translationOf(db, "ui.continue", "en")?.updatedAt;
  const again = applySnapshot(db, project.id, seeds);
  expect(again.seeded).toBe(0);
  expect(again.seedsIdentical).toBe(1);
  expect(translationOf(db, "ui.continue", "en")?.updatedAt).toEqual(before);
});

test("a seed that is the source restructured, as a TMS fills a target file, is the source's text: untranslated and counted apart (#1009)", () => {
  const { db, project } = seed();
  const copy =
    "{n,plural,=0 {Nenhuma marca por encontrar.} one {Falta {n, number} marca.} other {Faltam {n,number} marcas.}}";
  const report = applySnapshot(
    db,
    project.id,
    withSeeds({ en: { "ui.marks-left": copy } }),
  );
  expect(report.seedsIdentical).toBe(1);
  expect(report.seeded).toBe(0);
  expect(translationOf(db, "ui.marks-left", "en")).toMatchObject({
    state: "untranslated",
    text: copy,
  });
  // A row that held a translation takes the copy as untranslated too;
  // one that differs in a branch's words is a translation.
  applySnapshot(
    db,
    project.id,
    withSeeds({ en: { "ui.marks-left": "{n, plural, other {# marks}}" } }),
  );
  expect(translationOf(db, "ui.marks-left", "en")?.state).toBe("translated");
  const again = applySnapshot(
    db,
    project.id,
    withSeeds({ en: { "ui.marks-left": copy } }),
  );
  expect(again.seedsIdentical).toBe(1);
  expect(translationOf(db, "ui.marks-left", "en")?.state).toBe("untranslated");
  applySnapshot(
    db,
    project.id,
    withSeeds({ en: { "ui.marks-left": copy.replace("marcas.", "marcas!") } }),
  );
  expect(translationOf(db, "ui.marks-left", "en")?.state).toBe("translated");
});

test("a push's seed digests are kept per target language, merged over the last push's, left by a push that carries none, and not stored for a language the project lacks (#601)", () => {
  const { db, project } = seed();
  db.update(projects)
    .set({ languages: ["pt-PT", "en", "fr"] })
    .where(eq(projects.id, project.id))
    .run();
  const read = () =>
    db
      .select({ d: projects.seedDigests })
      .from(projects)
      .where(eq(projects.id, project.id))
      .get()?.d;
  applySnapshot(db, project.id, {
    ...withSeeds({ en: { "ui.continue": "Continue" } }),
    seedDigests: { en: "aaaa", fr: "ffff" },
  });
  expect(read()).toEqual({ en: "aaaa", fr: "ffff" });
  applySnapshot(db, project.id, { ...FIXTURE, seedDigests: { en: "bbbb" } });
  expect(read()).toEqual({ en: "bbbb", fr: "ffff" });
  applySnapshot(db, project.id, FIXTURE);
  expect(read()).toEqual({ en: "bbbb", fr: "ffff" });
  // A dry run stores nothing.
  applySnapshot(
    db,
    project.id,
    { ...FIXTURE, seedDigests: { en: "cccc" } },
    { dryRun: true },
  );
  expect(read()).toEqual({ en: "bbbb", fr: "ffff" });
  // A language the project does not have is not stored: its seeds were
  // ignored, so a digest kept for it would skip them once it is added.
  applySnapshot(db, project.id, {
    ...FIXTURE,
    seedDigests: { en: "dddd", de: "eeee" },
  });
  expect(read()).toEqual({ en: "dddd", fr: "ffff" });
});

test("a row with Corpus edit history keeps its text over a later seed", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, FIXTURE);
  const [ana] = db
    .insert(users)
    .values({ name: "ana", maintainer: true })
    .returning()
    .all();
  const row = stringRow(db, "ui.continue")!;
  applyTransition(db, {
    stringId: row.id,
    language: "en",
    action: { type: "save", text: "Carry on" },
    actor: ana!,
  });
  const report = applySnapshot(
    db,
    project.id,
    withSeeds({
      en: { "ui.continue": "Continue", "skin.heard-nothing": "Heard nothing." },
    }),
  );
  expect(report.seeded).toBe(1);
  expect(report.seedsIgnored).toBe(1);
  expect(translationOf(db, "ui.continue", "en")?.text).toBe("Carry on");
  expect(translationOf(db, "skin.heard-nothing", "en")?.text).toBe(
    "Heard nothing.",
  );
});

test("seeds for unknown ids, unknown languages, and the source language are ignored, not errors", () => {
  const { db, project } = seed();
  const report = applySnapshot(
    db,
    project.id,
    withSeeds({
      en: { "nope.missing": "x", "ui.continue": "Continue" },
      fr: { "ui.continue": "Continuer" },
      "pt-PT": { "ui.continue": "Prosseguir" },
    }),
  );
  expect(report.seeded).toBe(1);
  expect(report.seedsIgnored).toBe(3);
  expect(translationOf(db, "ui.continue", "pt-PT")?.text).toBeNull();
  expect(stringRow(db, "ui.continue")?.source).toBe("Continuar");
});

test("a dry run reports seeds without applying them", () => {
  const { db, project } = seed();
  const report = applySnapshot(
    db,
    project.id,
    withSeeds({ en: { "ui.continue": "Continue" } }),
    { dryRun: true },
  );
  expect(report.seeded).toBe(1);
  expect(stringRow(db, "ui.continue")).toBeUndefined();
});

test("an applied push records one history row with its report; a dry run records none", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, FIXTURE, { dryRun: true });
  expect(db.select().from(pushes).all()).toHaveLength(0);

  const report = applySnapshot(
    db,
    project.id,
    withSeeds({
      en: { "skin.seen-at-greenhouse-window": "Seen at the window." },
    }),
  );
  const rows = db.select().from(pushes).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    projectId: project.id,
    stringCount: FIXTURE.strings.length,
    added: report.added,
    changed: 0,
    stale: 0,
    archived: 0,
    unarchived: 0,
    seeded: 1,
  });
  expect(rows[0]?.at).toBeInstanceOf(Date);

  const changed: Snapshot = {
    ...FIXTURE,
    strings: FIXTURE.strings.map((s, i) =>
      i === 0 ? { ...s, source: s.source + "!" } : s,
    ),
  };
  applySnapshot(db, project.id, changed);
  const second = db.select().from(pushes).all();
  expect(second).toHaveLength(2);
  expect(second[1]).toMatchObject({ changed: 1, stale: 1 });
});

test("a push gives existing strings rows for a language added since the last push", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, FIXTURE);
  db.update(projects)
    .set({ languages: ["pt-PT", "en", "de-DE"] })
    .where(eq(projects.id, project.id))
    .run();
  applySnapshot(db, project.id, FIXTURE);
  const rows = db
    .select()
    .from(stringTranslations)
    .where(eq(stringTranslations.language, "de-DE"))
    .all();
  expect(rows.length).toBe(FIXTURE.strings.length);
  expect(rows.every((r) => r.state === "untranslated")).toBe(true);
});

test("a push carries the type notes whole; one from an older CLI leaves them", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, moonlightManor as Snapshot);
  const notes = () =>
    db.select().from(projects).where(eq(projects.id, project.id)).get()
      ?.typeNotes;
  expect(notes()).toEqual(moonlightManor.typeNotes);
  const older: Snapshot = { ...(moonlightManor as Snapshot) };
  delete older.typeNotes;
  applySnapshot(db, project.id, older);
  expect(notes()).toEqual(moonlightManor.typeNotes);
  applySnapshot(db, project.id, {
    ...(moonlightManor as Snapshot),
    typeNotes: {},
  });
  expect(notes()).toEqual({});
});

test("a push carries the types read as HTML whole; one from an older CLI leaves them (#622)", () => {
  const { db, project } = seed();
  const html = () =>
    db.select().from(projects).where(eq(projects.id, project.id)).get()
      ?.richText;
  applySnapshot(db, project.id, {
    ...(moonlightManor as Snapshot),
    richText: { chrome: "html" },
  });
  expect(html()).toEqual({ chrome: "html" });
  applySnapshot(db, project.id, moonlightManor as Snapshot);
  expect(html()).toEqual({ chrome: "html" });
  applySnapshot(db, project.id, {
    ...(moonlightManor as Snapshot),
    richText: {},
  });
  expect(html()).toEqual({});
});

test("a push carries the glossary whole; one from an older CLI leaves it", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, moonlightManor as Snapshot);
  const glossary = () =>
    db.select().from(projects).where(eq(projects.id, project.id)).get()
      ?.glossary;
  expect(glossary()?.en?.map((e) => e.term)).toEqual([
    "janela",
    "noite",
    "vítima",
  ]);
  const older: Snapshot = { ...(moonlightManor as Snapshot) };
  delete older.glossary;
  applySnapshot(db, project.id, older);
  expect(glossary()?.en).toHaveLength(3);
  applySnapshot(db, project.id, {
    ...(moonlightManor as Snapshot),
    glossary: {},
  });
  expect(glossary()).toEqual({});
});

test("a seed the row already holds is not a write and not a count", () => {
  const { db, project } = seed();
  const seeded = {
    ...(moonlightManor as Snapshot),
    seedTranslations: { en: { "ui.continue": "Continue" } },
  };
  const first = applySnapshot(db, project.id, seeded);
  expect(first.seeded).toBe(1);
  const row = () => stringRow(db, "ui.continue")!;
  const before = db
    .select()
    .from(stringTranslations)
    .where(
      and(
        eq(stringTranslations.stringId, row().id),
        eq(stringTranslations.language, "en"),
      ),
    )
    .get()!;
  const again = applySnapshot(db, project.id, seeded);
  expect(again.seeded).toBe(0);
  expect(again.seedsIgnored).toBe(0);
  const after = db
    .select()
    .from(stringTranslations)
    .where(
      and(
        eq(stringTranslations.stringId, row().id),
        eq(stringTranslations.language, "en"),
      ),
    )
    .get()!;
  expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
});

test("an edit in another project on the same row number does not block a seed; a matching seed writes nothing", () => {
  const { db, project } = seed();
  const [other] = db
    .insert(projects)
    .values({
      slug: "other",
      name: "Other",
      sourceLanguage: "pt-PT",
      languages: ["pt-PT", "en"],
    })
    .returning()
    .all();
  const [editor] = db.insert(users).values({ name: "rui" }).returning().all();
  // The other project pushes first, so its rows take the low ids, and a
  // person edits its ui.continue in en.
  applySnapshot(db, other!.id, { ...FIXTURE, project: "other" });
  const otherRow = db
    .select()
    .from(strings)
    .where(
      and(
        eq(strings.projectId, other!.id),
        eq(strings.stringId, "ui.continue"),
      ),
    )
    .get()!;
  db.insert(edits)
    .values({
      stringId: otherRow.id,
      language: "en",
      userId: editor!.id,
      oldText: null,
      newText: "Go on",
      oldState: "untranslated",
      newState: "translated",
    })
    .run();
  const first = applySnapshot(
    db,
    project.id,
    withSeeds({ en: { "ui.continue": "Continue" } }),
  );
  expect(first.seeded).toBe(1);
  // Two projects hold a ui.continue, so the row is looked up by project.
  const mine = () => {
    const string = db
      .select()
      .from(strings)
      .where(
        and(
          eq(strings.projectId, project.id),
          eq(strings.stringId, "ui.continue"),
        ),
      )
      .get()!;
    return db
      .select()
      .from(stringTranslations)
      .where(
        and(
          eq(stringTranslations.stringId, string.id),
          eq(stringTranslations.language, "en"),
        ),
      )
      .get();
  };
  const row = mine();
  expect(row?.text).toBe("Continue");
  const stamp = row?.updatedAt?.getTime();
  const again = applySnapshot(
    db,
    project.id,
    withSeeds({ en: { "ui.continue": "Continue" } }),
  );
  expect(again.seeded).toBe(0);
  expect(mine()?.updatedAt?.getTime()).toBe(stamp);
});

test("a string's syntax is stored, and an i18next source is validated as such", () => {
  const { db, project } = seed();
  const entry = {
    id: "{{ count }} starred",
    type: "ui",
    source: "{{ count }} starred",
    syntax: "i18next" as const,
  };
  applySnapshot(db, project.id, {
    ...FIXTURE,
    strings: [...FIXTURE.strings, entry],
  });
  const row = db
    .select()
    .from(strings)
    .where(
      and(eq(strings.projectId, project.id), eq(strings.stringId, entry.id)),
    )
    .get();
  expect(row?.syntax).toBe("i18next");
  expect(stringRow(db, "ui.continue")?.syntax).toBeNull();
});

test("a push that names only the library stores it, as one that names only the old syntax does", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, {
    ...FIXTURE,
    strings: [
      { id: "a", type: "chrome", source: "Hi {{ name }}", library: "i18next" },
      { id: "b", type: "chrome", source: "Hi {{ name }}", syntax: "i18next" },
      { id: "c", type: "chrome", source: "Hi {name}" },
    ],
  });
  expect(stringRow(db, "a")?.syntax).toBe("i18next");
  expect(stringRow(db, "b")?.syntax).toBe("i18next");
  expect(stringRow(db, "c")?.syntax).toBeNull();
});

test("a seed identical to the source is translated in a variant of the source, or where the repository marks it (#658)", () => {
  const { db, project } = seed(["pt-PT", "en", "pt-BR"]);
  const seeds = {
    en: {
      "ui.continue": "Continuar",
      "skin.heard-nothing": "Não ouvi nada a noite toda.",
    },
    "pt-BR": { "ui.continue": "Continuar" },
  };
  // Without the declaration, identical seeds stay untranslated.
  applySnapshot(db, project.id, withSeeds(seeds));
  expect(translationOf(db, "ui.continue", "pt-BR")?.state).toBe("untranslated");
  // Declared, a push turns the rows it already has translated, and a
  // marked loanword in another language too.
  const report = applySnapshot(db, project.id, {
    ...withSeeds(seeds),
    sourceVariants: ["pt-BR"],
    seedTranslated: { en: ["ui.continue"] },
  });
  expect(translationOf(db, "ui.continue", "pt-BR")?.state).toBe("translated");
  expect(translationOf(db, "ui.continue", "en")?.state).toBe("translated");
  expect(translationOf(db, "skin.heard-nothing", "en")?.state).toBe(
    "untranslated",
  );
  expect(report.seedsIdentical).toBe(1);
  // A variant's untranslated rows are no work; another language's are.
  const languages = new Set(
    queueItems(db, project.id, "untranslated").items.map((i) => i.language),
  );
  expect(languages.has("pt-BR")).toBe(false);
  expect(languages.has("en")).toBe(true);
  // The declaration is the project's until a push drops it, and the
  // seeds resent with it are untranslated again.
  applySnapshot(db, project.id, { ...withSeeds(seeds), sourceVariants: [] });
  expect(translationOf(db, "ui.continue", "pt-BR")?.state).toBe("untranslated");
  expect(
    new Set(
      queueItems(db, project.id, "untranslated").items.map((i) => i.language),
    ).has("pt-BR"),
  ).toBe(true);
});

test("a first push seeds a variant's identical rows translated (#658)", () => {
  const { db, project } = seed(["pt-PT", "en", "pt-BR"]);
  applySnapshot(db, project.id, {
    ...withSeeds({ "pt-BR": { "ui.continue": "Continuar" } }),
    sourceVariants: ["pt-BR"],
  });
  expect(translationOf(db, "ui.continue", "pt-BR")?.state).toBe("translated");
});

test("a pushed entry's arguments are kept on the row, and a seed pluralising one of them is valid (#731)", () => {
  const { db, project } = seed();
  const snapshot: Snapshot = {
    ...structuredClone(FIXTURE),
    strings: [
      {
        id: "notifications.favorite %lld",
        type: FIXTURE.strings[0]!.type,
        source: "favoritou",
        library: "printf",
        arguments: ["%lld"],
      },
    ],
    seedTranslations: {
      en: {
        "notifications.favorite %lld":
          "{arg1, plural, one {starred} other {starred it}}",
      },
    },
  };
  applySnapshot(db, project.id, snapshot);
  const row = stringRow(db, "notifications.favorite %lld")!;
  expect(row.arguments).toEqual(["%lld"]);
  const en = db
    .select()
    .from(stringTranslations)
    .where(
      and(
        eq(stringTranslations.stringId, row.id),
        eq(stringTranslations.language, "en"),
      ),
    )
    .get();
  expect(en?.text).toBe("{arg1, plural, one {starred} other {starred it}}");
  expect(en?.invalid).toBe(false);
  // The next push reads the seed against the row it already holds.
  applySnapshot(db, project.id, snapshot);
  expect(translationOf(db, "notifications.favorite %lld", "en")?.invalid).toBe(
    false,
  );
  // A push without the field clears it, as for keyIsText.
  const bare = structuredClone(snapshot);
  delete bare.strings[0]!.arguments;
  applySnapshot(db, project.id, bare);
  expect(stringRow(db, "notifications.favorite %lld")?.arguments).toBeNull();
});

test("a push without a string's examples clears them; one that carries them keeps them (#788)", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, FIXTURE);
  const id = "skin.seen-at-greenhouse-window";
  expect(stringRow(db, id)?.examples).not.toBeNull();
  applySnapshot(db, project.id, FIXTURE);
  expect(stringRow(db, id)?.examples).toEqual(
    FIXTURE.strings.find((s) => s.id === id)!.examples,
  );
  applySnapshot(db, project.id, {
    ...FIXTURE,
    strings: FIXTURE.strings.map((s) =>
      s.id === id ? { ...s, examples: undefined } : s,
    ),
  });
  expect(stringRow(db, id)?.examples ?? null).toBeNull();
});

test("a push stores a string's suggestions per language, a later push without them clears them, and a suggestion never changes a row's state (#773)", () => {
  const { db, project } = seed();
  const id = "skin.seen-at-greenhouse-window";
  applySnapshot(db, project.id, {
    ...FIXTURE,
    seedSuggestions: { en: { [id]: "A guess", "no.such.id": "x" } },
  });
  const row = () =>
    db
      .select()
      .from(stringTranslations)
      .where(
        and(
          eq(stringTranslations.stringId, stringRow(db, id)!.id),
          eq(stringTranslations.language, "en"),
        ),
      )
      .get()!;
  expect(row().suggestion).toBe("A guess");
  expect(row().state).toBe("untranslated");
  expect(row().text).toBeNull();
  applySnapshot(db, project.id, FIXTURE);
  expect(row().suggestion).toBeNull();
});

test("a push's suggestion clear reads the rows that hold one through their partial index (#810)", () => {
  const { db, project } = seed();
  const client = (db as unknown as { $client: BetterSqlite }).$client;
  const { sql, params } = suggestionClear(db, project.id).toSQL();
  const plan = client.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as {
    detail: string;
  }[];
  expect(plan.map((p) => p.detail).join("\n")).toContain(
    "translations_suggestion",
  );
});

test("a source change re-checks the marks of the seeds the push leaves out, never a row a translator edited (#857)", () => {
  const { db, project } = seed();
  const withSource = (source: string) =>
    FIXTURE.strings.map((s) => (s.id === "ui.continue" ? { ...s, source } : s));
  applySnapshot(
    db,
    project.id,
    withSeeds({ en: { "ui.continue": "Continue {name}" } }),
  );
  expect(translationOf(db, "ui.continue", "en")?.invalid).toBe(true);
  // The source gains {name}; the seed is unchanged, so the CLI's digest
  // leaves it out of the push.
  applySnapshot(db, project.id, withSeeds({}, withSource("Continuar {name}")));
  expect(translationOf(db, "ui.continue", "en")?.invalid).toBe(false);
  expect(
    queueItems(db, project.id, "invalid").items.map((i) => i.key),
  ).not.toContain("ui.continue");
  // It loses it again: the unchanged seed is broken by the new source.
  applySnapshot(db, project.id, withSeeds({}, withSource("Continuar")));
  expect(translationOf(db, "ui.continue", "en")?.invalid).toBe(true);
  // A row a translator saved is theirs: a source change leaves its mark.
  const [ana] = db
    .insert(users)
    .values({ name: "ana", maintainer: true })
    .returning()
    .all();
  applyTransition(db, {
    stringId: stringRow(db, "ui.continue")!.id,
    language: "en",
    action: { type: "save", text: "Continue {name}" },
    actor: ana!,
  });
  applySnapshot(db, project.id, withSeeds({}, withSource("Continuar!")));
  expect(translationOf(db, "ui.continue", "en")?.invalid).toBe(false);
});

test("a verified seed is still the repository's: a source change re-checks its mark (#857)", () => {
  const { db, project } = seed();
  const withSource = (source: string) =>
    FIXTURE.strings.map((s) => (s.id === "ui.continue" ? { ...s, source } : s));
  applySnapshot(
    db,
    project.id,
    withSeeds({ en: { "ui.continue": "Continue {name}" } }),
  );
  const [ana] = db
    .insert(users)
    .values({ name: "ana", maintainer: true })
    .returning()
    .all();
  applyTransition(db, {
    stringId: stringRow(db, "ui.continue")!.id,
    language: "en",
    action: { type: "verify" },
    actor: ana!,
  });
  expect(translationOf(db, "ui.continue", "en")).toMatchObject({
    state: "verified",
    invalid: true,
  });
  applySnapshot(db, project.id, withSeeds({}, withSource("Continuar {name}")));
  expect(translationOf(db, "ui.continue", "en")?.invalid).toBe(false);
});

test("a push that changes a string's arguments, library or type's richText re-checks its seeds' marks (#891)", () => {
  const { db, project } = seed();
  const id = "notifications.favorite %lld";
  const favorite = (fields: Partial<Snapshot["strings"][number]>) => [
    {
      id,
      type: "chrome",
      source: "favoritou",
      library: "printf" as const,
      arguments: ["%lld"],
      ...fields,
    },
  ];
  const push = (
    strings: Snapshot["strings"],
    seeds: Record<string, Record<string, string>> = {},
    richText?: Snapshot["richText"],
  ) =>
    applySnapshot(db, project.id, {
      ...FIXTURE,
      strings,
      seedTranslations: seeds,
      ...(richText && { richText }),
    });
  push(favorite({}), {
    en: { [id]: "{arg1, plural, one {starred} other {starred it}}" },
  });
  expect(translationOf(db, id, "en")?.invalid).toBe(false);
  // The seed is unchanged, so the digest leaves it out; the key's verbs
  // went, and with them the value it pluralises on.
  push(favorite({ arguments: undefined }));
  expect(translationOf(db, id, "en")?.invalid).toBe(true);
  push(favorite({}));
  expect(translationOf(db, id, "en")?.invalid).toBe(false);
  // A library that reads no argN plural.
  push(favorite({ library: "icu" }));
  expect(translationOf(db, id, "en")?.invalid).toBe(true);
  push(favorite({}));
  expect(translationOf(db, id, "en")?.invalid).toBe(false);
  // A tag the source lacks is invalid until the type reads as HTML.
  const bold = favorite({
    library: undefined,
    arguments: undefined,
    source: "Seguir",
  });
  push(bold, { en: { [id]: "<b>Follow</b>" } });
  expect(translationOf(db, id, "en")?.invalid).toBe(true);
  push(bold, {}, { chrome: "html" });
  expect(translationOf(db, id, "en")?.invalid).toBe(false);
});

test("an example value keyed __proto__ is stored with the string as any placeholder's is (#878)", () => {
  const { db, project } = seed();
  // JSON.parse keeps `__proto__` an own key, as a pushed body does.
  const examples = JSON.parse('[{"values":{"__proto__":"P"},"rendered":"P"}]');
  const snapshot = snapshotSchema.parse(
    JSON.parse(
      JSON.stringify({
        ...FIXTURE,
        strings: [{ ...FIXTURE.strings[0]!, examples }],
      }),
    ),
  );
  applySnapshot(db, project.id, snapshot);
  const stored = stringRow(db, FIXTURE.strings[0]!.id)?.examples as {
    values: Record<string, string>;
  }[];
  expect(Object.hasOwn(stored[0]!.values, "__proto__")).toBe(true);
  expect(stored[0]!.values["__proto__"]).toBe("P");
});

test("a seed identical to its source is never invalid, whichever push writes it (#923)", () => {
  const { db, project } = seed(["pt-PT", "en", "pt-BR"]);
  // A # in a select within a plural: warned in a source, refused in a
  // translation.
  const source =
    "{n, plural, one {{g, select, a {# x} other {y}}} other {{g, select, a {# xs} other {ys}}}}";
  const push = () =>
    applySnapshot(db, project.id, {
      ...FIXTURE,
      strings: [{ ...FIXTURE.strings[0]!, source }],
      sourceVariants: ["pt-BR"],
      seedTranslations: { "pt-BR": { [FIXTURE.strings[0]!.id]: source } },
    });
  push();
  expect(translationOf(db, FIXTURE.strings[0]!.id, "pt-BR")).toMatchObject({
    state: "translated",
    invalid: false,
  });
  push();
  expect(translationOf(db, FIXTURE.strings[0]!.id, "pt-BR")?.invalid).toBe(
    false,
  );
});

test("a string moved from a type read as HTML to a plain one marks its seed's tag (#923)", () => {
  const { db, project } = seed();
  const id = FIXTURE.strings[0]!.id;
  const strings = (type: string) => [
    { ...FIXTURE.strings[0]!, type, source: "Seguir", examples: undefined },
  ];
  applySnapshot(db, project.id, {
    ...FIXTURE,
    strings: strings("rich"),
    richText: { rich: "html" },
    seedTranslations: { en: { [id]: "<b>Follow</b>" } },
  });
  expect(translationOf(db, id, "en")?.invalid).toBe(false);
  // No seeds: the digest leaves the unchanged one out.
  applySnapshot(db, project.id, {
    ...FIXTURE,
    strings: strings("plain"),
    richText: { rich: "html" },
    seedTranslations: {},
  });
  expect(translationOf(db, id, "en")?.invalid).toBe(true);
});

test("a row a push resets to untranslated is no longer stale (#934)", () => {
  const { db, project } = seed();
  const id = FIXTURE.strings[0]!.id;
  const push = (source: string) =>
    applySnapshot(db, project.id, {
      ...FIXTURE,
      strings: [{ ...FIXTURE.strings[0]!, source, examples: undefined }],
      seedTranslations: { en: { [id]: "Seguir" } },
    });
  push("Seguir");
  push("Continuar");
  expect(translationOf(db, id, "en")).toMatchObject({ state: "translated" });
  // Back to its seed's text: the source change marks the row stale, and
  // the seed, identical again, leaves it untranslated.
  push("Seguir");
  expect(translationOf(db, id, "en")).toMatchObject({
    state: "untranslated",
    stale: false,
  });
  expect(queueItems(db, project.id, "stale").items).toEqual([]);
});

test("a gettext plural's categories per language are kept on the row and reach the string's detail (#951)", () => {
  const { db, project } = seed();
  const snapshot: Snapshot = {
    ...structuredClone(FIXTURE),
    strings: [
      {
        id: "%d note",
        type: FIXTURE.strings[0]!.type,
        source: "{count, plural, one {%d note} other {%d notes}}",
        library: "printf",
        pluralForms: { it: ["one", "other"] },
      },
    ],
  };
  applySnapshot(db, project.id, snapshot);
  expect(stringRow(db, "%d note")?.pluralForms).toEqual({
    it: ["one", "other"],
  });
  expect(stringDetail(db, project.id, "%d note")?.string.pluralForms).toEqual({
    it: ["one", "other"],
  });
  // A push without the field clears it: the file now picks CLDR's.
  const bare = structuredClone(snapshot);
  delete bare.strings[0]!.pluralForms;
  applySnapshot(db, project.id, bare);
  expect(stringRow(db, "%d note")?.pluralForms).toBeNull();
});

test("a vue string's plural rule is kept on the row, reaches its detail, and a push without it clears it (#1018)", () => {
  const { db, project } = seed();
  const snapshot: Snapshot = {
    ...structuredClone(FIXTURE),
    strings: [
      {
        id: "minutes",
        type: FIXTURE.strings[0]!.type,
        source: "{n} minute | {n} minutes",
        library: "vue",
        pluralRules: "default",
      },
    ],
  };
  applySnapshot(db, project.id, snapshot);
  expect(stringRow(db, "minutes")?.pluralRules).toBe("default");
  expect(stringDetail(db, project.id, "minutes")?.string.pluralRules).toBe(
    "default",
  );
  const bare = structuredClone(snapshot);
  delete bare.strings[0]!.pluralRules;
  applySnapshot(db, project.id, bare);
  expect(stringRow(db, "minutes")?.pluralRules).toBeNull();
});

test("a push's seed of a Rails _html key writes its own tags, but a tag it leaves unclosed is marked invalid (#988)", () => {
  const { db, project } = seed();
  const strings = [
    {
      id: "about.hint_html",
      type: "chrome",
      source: 'Read <strong>this</strong> <a href="%{path}">here</a>',
      library: "rails" as const,
    },
    {
      id: "about.plain",
      type: "chrome",
      source: "Read <strong>this</strong>",
      library: "rails" as const,
    },
  ];
  applySnapshot(db, project.id, {
    ...FIXTURE,
    strings,
    seedTranslations: {
      en: {
        "about.hint_html": 'Read <em>this</em> <a href="%{path}">here</a>',
        "about.plain": "Read this",
      },
    },
  });
  expect(translationOf(db, "about.hint_html", "en")?.invalid).toBe(false);
  expect(translationOf(db, "about.plain", "en")?.invalid).toBe(true);
  applySnapshot(db, project.id, {
    ...FIXTURE,
    strings,
    seedTranslations: {
      en: {
        "about.hint_html": 'Read <em>this</em> <a href="%{path}">here< /a>',
      },
    },
  });
  expect(translationOf(db, "about.hint_html", "en")?.invalid).toBe(true);
});

test("a Fluent term's seed selects on its locale's own keys and is no invalid row; a message's with translated keys is (#1032)", () => {
  const { db, project } = seed();
  const source =
    "{capitalization, select, lowercase {account} uppercase {Account} other {account}}";
  const fluent = (id: string) => ({
    id,
    type: FIXTURE.strings[0]!.type,
    source,
    library: "fluent" as const,
    syntax: "fluent" as const,
  });
  // Two keys of its own, none the source's, neither the default's text.
  const keys =
    "{capitalization, select, lower {účet} upper {ÚČET} other {Účet}}";
  applySnapshot(
    db,
    project.id,
    withSeeds({ en: { "-brand-account": keys, "ui:account": keys } }, [
      fluent("-brand-account"),
      fluent("ui:account"),
    ]),
  );
  expect(translationOf(db, "-brand-account", "en")?.invalid).toBe(false);
  expect(translationOf(db, "ui:account", "en")?.invalid).toBe(true);
});

test("a string's languages bound its rows: none outside, a widened set adds them, a narrowed one hides a translation and drops an empty row (#1006)", () => {
  const { db, project } = seed(["pt-PT", "en", "de", "fr"]);
  const [ana] = db
    .insert(users)
    .values({ name: "ana", maintainer: true })
    .returning()
    .all();
  const snapshot = (qt: string[]): Snapshot => ({
    contract: "corpus/1",
    project: "moonlight-manor",
    sourceLanguage: "pt-PT",
    entities: [],
    strings: [
      { id: "gtk.quit", type: "ui", source: "Sair" },
      { id: "qt.quit", type: "ui", source: "Sair", languages: qt },
    ],
    seedTranslations: { de: { "qt.quit": "Beenden" } },
  });
  const languagesOf = (key: string) =>
    db
      .select({ language: stringTranslations.language })
      .from(stringTranslations)
      .where(eq(stringTranslations.stringId, stringRow(db, key)!.id))
      .all()
      .map((r) => r.language)
      .sort();
  const untranslated = () =>
    queueItems(db, project.id, "untranslated").items.map(
      (i) => `${i.key} ${i.language}`,
    );

  applySnapshot(db, project.id, snapshot(["de"]));
  expect(stringRow(db, "qt.quit")?.languages).toEqual(["pt-PT", "de"]);
  expect(stringRow(db, "gtk.quit")?.languages).toBeNull();
  expect(languagesOf("gtk.quit")).toEqual(["de", "en", "fr", "pt-PT"]);
  expect(languagesOf("qt.quit")).toEqual(["de", "pt-PT"]);
  expect(untranslated()).toEqual(["gtk.quit de", "gtk.quit en", "gtk.quit fr"]);
  expect(progressCounts(db, project.id).perLanguage.fr?.total).toBe(1);

  applySnapshot(db, project.id, snapshot(["de", "fr"]));
  expect(languagesOf("qt.quit")).toEqual(["de", "fr", "pt-PT"]);
  expect(untranslated()).toContain("qt.quit fr");
  applyTransition(db, {
    stringId: stringRow(db, "qt.quit")!.id,
    language: "fr",
    action: { type: "save", text: "Quitter" },
    actor: ana!,
  });

  // Narrowed: the translation stays in the database, out of every view.
  applySnapshot(db, project.id, snapshot(["de"]));
  expect(languagesOf("qt.quit")).toEqual(["de", "fr", "pt-PT"]);
  expect(progressCounts(db, project.id).perLanguage.fr?.total).toBe(1);
  const detail = stringDetail(db, project.id, "qt.quit");
  expect(Object.keys(detail!.translations).sort()).toEqual(["de", "pt-PT"]);
  expect(detail!.string.languages).toEqual(["pt-PT", "de"]);
  const row = listCatalogue(db, project.id).rows.find(
    (r) => r.stringId === "qt.quit",
  );
  expect(row?.languages).toEqual(["pt-PT", "de"]);
  expect(Object.keys(row!.states).sort()).toEqual(["de", "pt-PT"]);
  expect(
    listCatalogue(db, project.id, { language: "fr" }).rows.map(
      (r) => r.stringId,
    ),
  ).toEqual([]);
  expect(pullPayload(db, project, "untranslated").translations.fr).toEqual({});
  expect(
    applyTransition(db, {
      stringId: stringRow(db, "qt.quit")!.id,
      language: "fr",
      action: { type: "save", text: "Fermer" },
      actor: ana!,
    }),
  ).toEqual({ error: "not-found" });

  // Widened again, it is back as it was.
  applySnapshot(db, project.id, snapshot(["de", "fr"]));
  expect(translationOf(db, "qt.quit", "fr")?.text).toBe("Quitter");

  // An empty row outside the set is dropped; a translated one is kept.
  applySnapshot(db, project.id, snapshot(["de", "en"]));
  expect(languagesOf("qt.quit")).toEqual(["de", "en", "fr", "pt-PT"]);
  applySnapshot(db, project.id, snapshot(["de"]));
  expect(languagesOf("qt.quit")).toEqual(["de", "fr", "pt-PT"]);
  applySnapshot(db, project.id, {
    ...snapshot([]),
    strings: [
      { id: "gtk.quit", type: "ui", source: "Sair" },
      { id: "qt.quit", type: "ui", source: "Sair" },
    ],
  });
  expect(stringRow(db, "qt.quit")?.languages).toBeNull();
  expect(languagesOf("qt.quit")).toEqual(["de", "en", "fr", "pt-PT"]);
});

test("a seed outside a string's languages is ignored, and the stale count is of the rows it takes (#1006)", () => {
  const { db, project } = seed(["pt-PT", "en", "de", "fr"]);
  const push = (source: string, languages: string[]) =>
    applySnapshot(db, project.id, {
      contract: "corpus/1",
      project: "moonlight-manor",
      sourceLanguage: "pt-PT",
      entities: [],
      strings: [{ id: "qt.quit", type: "ui", source, languages }],
      seedTranslations: {
        de: { "qt.quit": "Beenden" },
        fr: { "qt.quit": "Quitter" },
      },
    });
  const first = push("Sair", ["de"]);
  expect(first.seeded).toBe(1);
  expect(first.seedsIgnored).toBe(1);
  expect(translationOf(db, "qt.quit", "fr")).toBeUndefined();
  // fr's translation is kept hidden once the set narrows again.
  push("Sair", ["de", "fr"]);
  expect(translationOf(db, "qt.quit", "fr")?.text).toBe("Quitter");
  const narrowed = push("Sair", ["de"]);
  expect(narrowed.seedsIgnored).toBe(1);
  const changed = push("Sair agora", ["de"]);
  expect(changed.stale).toBe(1);
  expect(queueItems(db, project.id, "stale").count).toBe(1);
  // One push that changes the set and the source counts by the new set.
  const widened = push("Sair já", ["de", "fr"]);
  expect(widened.stale).toBe(2);
  expect(queueItems(db, project.id, "stale").count).toBe(2);
  const narrowed2 = push("Sair", ["de"]);
  expect(narrowed2.stale).toBe(1);
  expect(queueItems(db, project.id, "stale").count).toBe(1);
});
