import { moonlightManor, type Snapshot } from "@corpus/contract";
import { expect, test } from "vitest";
import { applySnapshot } from "@/ingest/apply";
import { projects } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { getProjectBySlug } from "@/projects/service";
import { deriveFacets } from "./facets";
import { listCatalogue } from "./query";

function pushed() {
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
  applySnapshot(db, p.id, moonlightManor as Snapshot);
  return { db, project: getProjectBySlug(db, "mm")! };
}

test("ingest persists the declarations on the project", () => {
  const { project } = pushed();
  expect(project.stringTypes?.["clue-skin"]?.kind?.type).toBe("enum");
});

test("facets are auto-generated from declarations — enum + flag + ref", () => {
  const { project } = pushed();
  const facets = deriveFacets(
    project.stringTypes,
    ["clue-skin", "chrome"],
    project.languages,
  );
  const kind = facets.find((f) => f.key === "meta.kind");
  expect(kind).toMatchObject({ kind: "enum", field: "kind" });
  if (kind?.kind === "enum") expect(kind.options).toContain("sighting");
  expect(facets.find((f) => f.key === "meta.requires_windows")?.kind).toBe(
    "flag",
  );
  expect(facets.find((f) => f.key === "meta.requires_trait")?.kind).toBe("ref");
  // built-ins present
  expect(facets.map((f) => f.key)).toEqual(
    expect.arrayContaining(["type", "state", "language", "archived"]),
  );
});

test("filtering by an enum value narrows the list", () => {
  const { db, project } = pushed();
  const sightings = listCatalogue(db, project.id, {
    metadata: { kind: "sighting" },
  }).rows;
  expect(sightings.map((r) => r.stringId)).toEqual([
    "skin.seen-at-greenhouse-window",
  ]);
});

test("filtering by a flag narrows the list", () => {
  const { db, project } = pushed();
  const windowed = listCatalogue(db, project.id, {
    metadata: { requires_windows: "true" },
  }).rows;
  expect(windowed.every((r) => r.stringId.startsWith("skin."))).toBe(true);
  expect(windowed).toHaveLength(1);
});

test("combining a type and a metadata facet narrows further", () => {
  const { db, project } = pushed();
  const combined = listCatalogue(db, project.id, {
    types: ["clue-skin"],
    metadata: { kind: "alibi" },
  }).rows;
  expect(combined.map((r) => r.stringId)).toEqual(["skin.heard-nothing"]);
});

test("filtering by language + state narrows the list", () => {
  const { db, project } = pushed();
  const untranslatedEn = listCatalogue(db, project.id, {
    language: "en",
    states: ["untranslated"],
  }).rows;
  expect(untranslatedEn.length).toBe(moonlightManor.strings.length);
  const verifiedEn = listCatalogue(db, project.id, {
    language: "en",
    states: ["verified"],
  }).rows;
  expect(verifiedEn).toHaveLength(0);
});
