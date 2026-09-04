import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { entities, projects, strings, stringTranslations } from "./schema";
import { memoryDb } from "./test-helpers";

function seedProject(db = memoryDb()) {
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
  if (!project) throw new Error("insert failed");
  return { db, project };
}

test("projects round-trip including the JSON languages column", () => {
  const { db, project } = seedProject();
  const row = db
    .select()
    .from(projects)
    .where(eq(projects.id, project.id))
    .get();
  expect(row?.languages).toEqual(["pt-PT", "en"]);
  expect(row?.slug).toBe("moonlight-manor");
});

test("strings store metadata and examples as JSON and default archived=false", () => {
  const { db, project } = seedProject();
  const [row] = db
    .insert(strings)
    .values({
      projectId: project.id,
      stringId: "skin.seen",
      type: "clue-skin",
      source: "{person} foi visto.",
      metadata: { kind: "sighting", requires_windows: true },
      examples: [{ values: { person: "x" }, rendered: "x foi visto." }],
    })
    .returning()
    .all();
  expect(row?.metadata).toEqual({ kind: "sighting", requires_windows: true });
  expect(row?.examples).toHaveLength(1);
  expect(row?.archived).toBe(false);
});

test("(project, string id) is unique", () => {
  const { db, project } = seedProject();
  const value = {
    projectId: project.id,
    stringId: "dup",
    type: "t",
    source: "s",
  };
  db.insert(strings).values(value).run();
  expect(() => db.insert(strings).values(value).run()).toThrow();
});

test("the same string id in a different project is allowed", () => {
  const { db, project } = seedProject();
  const [other] = db
    .insert(projects)
    .values({
      slug: "other",
      name: "Other",
      sourceLanguage: "en",
      languages: ["en"],
    })
    .returning()
    .all();
  if (!other) throw new Error("insert failed");
  db.insert(strings)
    .values({ projectId: project.id, stringId: "x", type: "t", source: "s" })
    .run();
  expect(() =>
    db
      .insert(strings)
      .values({ projectId: other.id, stringId: "x", type: "t", source: "s" })
      .run(),
  ).not.toThrow();
});

test("entities round-trip with JSON attributes; (project, entity id) unique", () => {
  const { db, project } = seedProject();
  const value = {
    projectId: project.id,
    entityId: "trait:insomnia",
    type: "trait",
    name: "Insónia",
    attributes: { summary: "wanders at night" },
  };
  const [row] = db.insert(entities).values(value).returning().all();
  expect(row?.attributes).toEqual({ summary: "wanders at night" });
  expect(() => db.insert(entities).values(value).run()).toThrow();
});

test("translations default to untranslated/not-stale; (string, language) unique", () => {
  const { db, project } = seedProject();
  const [s] = db
    .insert(strings)
    .values({ projectId: project.id, stringId: "a", type: "t", source: "s" })
    .returning()
    .all();
  if (!s) throw new Error("insert failed");
  const [row] = db
    .insert(stringTranslations)
    .values({ stringId: s.id, language: "en" })
    .returning()
    .all();
  expect(row?.state).toBe("untranslated");
  expect(row?.stale).toBe(false);
  expect(() =>
    db
      .insert(stringTranslations)
      .values({ stringId: s.id, language: "en" })
      .run(),
  ).toThrow();
});

test("translation state only accepts the three §11 values", () => {
  const { db, project } = seedProject();
  const [s] = db
    .insert(strings)
    .values({ projectId: project.id, stringId: "a", type: "t", source: "s" })
    .returning()
    .all();
  if (!s) throw new Error("insert failed");
  db.insert(stringTranslations)
    .values({ stringId: s.id, language: "en", state: "verified" })
    .run();
  const row = db.select().from(stringTranslations).get();
  expect(row?.state).toBe("verified");
});

test("string -> project foreign key is enforced", () => {
  const db = memoryDb();
  expect(() =>
    db
      .insert(strings)
      .values({ projectId: 999, stringId: "a", type: "t", source: "s" })
      .run(),
  ).toThrow();
});
