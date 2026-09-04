import { moonlightManor, type Snapshot } from "@corpus/contract";
import { expect, test } from "vitest";
import { projects, strings } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "./apply";

const FIXTURE = moonlightManor as Snapshot;

function seed() {
  const db = memoryDb();
  const [project] = db
    .insert(projects)
    .values({
      slug: "moonlight-manor",
      name: "Moonlight Manor",
      sourceLanguage: "pt-PT",
      languages: ["pt-PT", "en"],
    })
    .returning()
    .all();
  if (!project) throw new Error("seed failed");
  return { db, project };
}

test("dry run returns the exact same report as a real push", () => {
  const dry = seed();
  const dryReport = applySnapshot(dry.db, dry.project.id, FIXTURE, {
    dryRun: true,
  });
  const real = seed();
  const realReport = applySnapshot(real.db, real.project.id, FIXTURE);
  expect(dryReport).toEqual(realReport);
});

test("dry run leaves the database untouched", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, FIXTURE, { dryRun: true });
  expect(db.select().from(strings).all()).toHaveLength(0);
});

test("dry run on a second push reports changes without applying them", () => {
  const { db, project } = seed();
  applySnapshot(db, project.id, FIXTURE);
  const changed = structuredClone(FIXTURE);
  changed.strings[0]!.source = "{person} apareceu.";

  const report = applySnapshot(db, project.id, changed, { dryRun: true });
  expect(report.changed).toBe(1);
  expect(report.stale).toBe(1);
  // Real state is unchanged: the source still reads the original.
  const row = db.select().from(strings).all()[0];
  expect(row?.source).toContain("foi");
});
