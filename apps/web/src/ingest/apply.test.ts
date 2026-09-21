import { moonlightManor, type Snapshot } from "@corpus/contract";
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
import { applySnapshot } from "./apply";

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

test("changing a source stales its target rows and resets the source row", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, FIXTURE);
  const changed = structuredClone(FIXTURE);
  changed.strings[0]!.source = "{person} apareceu.";

  const report = applySnapshot(db, project.id, changed);
  expect(report.changed).toBe(1);
  expect(report.stale).toBe(1); // one target language (en)

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

  const report = applySnapshot(db, project.id, FIXTURE);
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
    seeded: 0,
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
