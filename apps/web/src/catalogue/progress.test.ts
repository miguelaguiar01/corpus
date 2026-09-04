import { moonlightManor, type Snapshot } from "@corpus/contract";
import { expect, test } from "vitest";
import { applySnapshot } from "@/ingest/apply";
import { searchStringIds } from "@/db/search";
import { projects } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { listCatalogue } from "./query";
import { progressCounts } from "./progress";

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
  return { db, p };
}

test("counts match a hand-computed expectation for the fixture", () => {
  const { db, p } = pushed();
  const { perLanguage } = progressCounts(db, p.id);
  // 3 strings: source pt-PT all translated, target en all untranslated.
  expect(perLanguage["pt-PT"]).toMatchObject({
    translated: 3,
    untranslated: 0,
    total: 3,
  });
  expect(perLanguage["en"]).toMatchObject({
    untranslated: 3,
    translated: 0,
    total: 3,
  });
});

test("progress excludes archived strings", () => {
  const { db, p } = pushed();
  const fewer = structuredClone(moonlightManor) as Snapshot;
  fewer.strings = fewer.strings.filter((s) => s.id !== "ui.continue");
  applySnapshot(db, p.id, fewer); // archives ui.continue

  const { perLanguage } = progressCounts(db, p.id);
  expect(perLanguage["pt-PT"]?.total).toBe(2);
  expect(perLanguage["en"]?.total).toBe(2);
});

test("stale is counted after a source change", () => {
  const { db, p } = pushed();
  const changed = structuredClone(moonlightManor) as Snapshot;
  changed.strings[0]!.source = "{person} apareceu.";
  applySnapshot(db, p.id, changed);
  expect(progressCounts(db, p.id).perLanguage["en"]?.stale).toBe(1);
});

test("progress is broken down per string type", () => {
  const { db, p } = pushed();
  const { perType } = progressCounts(db, p.id);
  expect(perType["clue-skin"]?.["pt-PT"]?.total).toBe(2);
  expect(perType["chrome"]?.["pt-PT"]?.total).toBe(1);
});

test("search composes with facet filters at the query layer", () => {
  const { db, p } = pushed();
  // "janela" matches only the sighting string; combined with kind=alibi it
  // should match nothing (the sighting is a sighting, not an alibi).
  const ids = searchStringIds(db, p.id, "janela");
  expect(ids.length).toBe(1);
  const both = listCatalogue(db, p.id, {
    stringIds: ids,
    metadata: { kind: "alibi" },
  }).rows;
  expect(both).toHaveLength(0);
  const matching = listCatalogue(db, p.id, {
    stringIds: ids,
    metadata: { kind: "sighting" },
  }).rows;
  expect(matching.map((r) => r.stringId)).toEqual([
    "skin.seen-at-greenhouse-window",
  ]);
});
