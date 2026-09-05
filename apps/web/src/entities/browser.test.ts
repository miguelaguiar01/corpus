import { moonlightManor, type Snapshot } from "@corpus/contract";
import { expect, test } from "vitest";
import { projects } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "@/ingest/apply";
import { entitiesByType } from "./browser";

const FIXTURE = moonlightManor as Snapshot;

function pushed(withLabels = true) {
  const db = memoryDb();
  const [p] = db
    .insert(projects)
    .values({
      slug: "mm",
      name: "MM",
      sourceLanguage: "pt-PT",
      languages: ["pt-PT", "en"],
    })
    .returning()
    .all();
  if (!p) throw new Error("seed failed");
  const snapshot = { ...FIXTURE };
  if (!withLabels) delete snapshot.entityTypes;
  applySnapshot(db, p.id, snapshot);
  return { db, p };
}

test("groups the fixture's entities by type with declared labels, types and names sorted", () => {
  const { db, p } = pushed();
  const groups = entitiesByType(db, p.id);
  expect(groups.map((g) => [g.type, g.label, g.entities.length])).toEqual([
    ["character", "Character", 2],
    ["room", "Room", 1],
    ["trait", "Trait", 1],
  ]);
  expect(groups[0]?.entities.map((e) => e.name)).toEqual([
    "Condessa Rosa",
    "Doutor Vaz",
  ]);
  expect(groups[2]?.entities[0]).toMatchObject({
    entityId: "trait:insomnia",
    typeLabel: "Trait",
    attributes: { summary: expect.any(String) },
  });
});

test("an undeclared type label falls back to the type key", () => {
  const { db, p } = pushed(false);
  const groups = entitiesByType(db, p.id);
  expect(groups.map((g) => g.label)).toEqual(["character", "room", "trait"]);
});

test("a project with no entities yields no groups", () => {
  const db = memoryDb();
  const [p] = db
    .insert(projects)
    .values({ slug: "e", name: "E", sourceLanguage: "en", languages: ["en"] })
    .returning()
    .all();
  expect(entitiesByType(db, p!.id)).toEqual([]);
});
