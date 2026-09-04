import { moonlightManor, type Snapshot } from "@corpus/contract";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import type { Db } from "@/db";
import { entities, projects, strings, stringTranslations } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
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
