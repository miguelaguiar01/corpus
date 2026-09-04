import { moonlightManor, type Snapshot } from "@corpus/contract";
import { expect, test } from "vitest";
import { applySnapshot } from "@/ingest/apply";
import { projects } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
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
  return { db, p };
}

test("lists the pushed strings with per-language states (§11)", () => {
  const { db, p } = pushed();
  const { rows } = listCatalogue(db, p.id);
  expect(rows.length).toBe(moonlightManor.strings.length);
  const sighting = rows.find(
    (r) => r.stringId === "skin.seen-at-greenhouse-window",
  );
  expect(sighting?.states["pt-PT"]).toEqual({
    state: "translated",
    stale: false,
  });
  expect(sighting?.states["en"]).toEqual({
    state: "untranslated",
    stale: false,
  });
});

test("archived strings are hidden by default and shown on request", () => {
  const { db, p } = pushed();
  const fewer = structuredClone(moonlightManor) as Snapshot;
  fewer.strings = fewer.strings.filter((s) => s.id !== "ui.continue");
  applySnapshot(db, p.id, fewer); // archives ui.continue

  const hidden = listCatalogue(db, p.id).rows.map((r) => r.stringId);
  expect(hidden).not.toContain("ui.continue");

  const all = listCatalogue(db, p.id, { includeArchived: true }).rows;
  const archived = all.find((r) => r.stringId === "ui.continue");
  expect(archived?.archived).toBe(true);
});

test("stale is reflected after a source change", () => {
  const { db, p } = pushed();
  const changed = structuredClone(moonlightManor) as Snapshot;
  changed.strings[0]!.source = "{person} apareceu.";
  applySnapshot(db, p.id, changed);

  const row = listCatalogue(db, p.id).rows.find(
    (r) => r.stringId === "skin.seen-at-greenhouse-window",
  );
  expect(row?.states["en"]?.stale).toBe(true);
  expect(row?.states["pt-PT"]?.stale).toBe(false);
});

test("cursor pagination walks the whole set without overlap", () => {
  const { db, p } = pushed();
  const first = listCatalogue(db, p.id, { limit: 2 });
  expect(first.rows).toHaveLength(2);
  expect(first.nextCursor).not.toBeNull();

  const seen = new Set(first.rows.map((r) => r.stringId));
  let cursor = first.nextCursor;
  while (cursor !== null) {
    const next = listCatalogue(db, p.id, { limit: 2, cursor });
    for (const row of next.rows) seen.add(row.stringId);
    cursor = next.nextCursor;
  }
  expect(seen.size).toBe(moonlightManor.strings.length);
});
