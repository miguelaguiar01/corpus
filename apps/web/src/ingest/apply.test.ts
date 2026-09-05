import { moonlightManor, type Snapshot } from "@corpus/contract";
import { and, eq } from "drizzle-orm";
import { expect, test } from "vitest";
import type { Db } from "@/db";
import {
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
  expect(stringRow(db, "ui.continue")?.archived).toBe(true);
});

test("an archived string returning is unarchived", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, FIXTURE);
  const fewer = structuredClone(FIXTURE);
  fewer.strings.pop();
  applySnapshot(db, project.id, fewer);
  expect(stringRow(db, "ui.continue")?.archived).toBe(true);

  const report = applySnapshot(db, project.id, FIXTURE);
  expect(report.unarchived).toBe(1);
  expect(stringRow(db, "ui.continue")?.archived).toBe(false);
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
