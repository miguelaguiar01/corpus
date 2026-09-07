import { moonlightManor, type Snapshot } from "@corpus/contract";
import { expect, test } from "vitest";
import { applySnapshot } from "@/ingest/apply";
import { eq } from "drizzle-orm";
import { projects, strings, users } from "@/db/schema";
import { applyTransition } from "@/translations/service";
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

// One English translation saved and one Portuguese source verified, so
// the facets have something to tell apart.
function withHistory() {
  const { db, p } = pushed();
  const [ana] = db
    .insert(users)
    .values({ name: "ana", maintainer: true })
    .returning()
    .all();
  if (!ana) throw new Error("seed failed");
  const id = (key: string) =>
    db
      .select({ id: strings.id })
      .from(strings)
      .where(eq(strings.stringId, key))
      .get()!.id;
  const saved = applyTransition(db, {
    stringId: id("ui.continue"),
    language: "en",
    action: { type: "save", text: "Continue" },
    actor: ana,
  });
  const verified = applyTransition(db, {
    stringId: id("skin.heard-nothing"),
    language: "pt-PT",
    action: { type: "verify" },
    actor: ana,
  });
  for (const r of [saved, verified]) {
    if ("error" in r) throw new Error(String(r.error));
  }
  return { db, p };
}

test("a language alone lists the strings that have text in it", () => {
  const { db, p } = withHistory();
  const en = listCatalogue(db, p.id, { language: "en" }).rows;
  expect(en.map((r) => r.stringId)).toEqual(["ui.continue"]);
  const source = listCatalogue(db, p.id, { language: "pt-PT" }).rows;
  expect(source.length).toBe(moonlightManor.strings.length);
});

test("a state alone lists the strings in that state in any language", () => {
  const { db, p } = withHistory();
  const verified = listCatalogue(db, p.id, { states: ["verified"] }).rows;
  expect(verified.map((r) => r.stringId)).toEqual(["skin.heard-nothing"]);
  const untranslated = listCatalogue(db, p.id, {
    states: ["untranslated"],
  }).rows;
  expect(untranslated.length).toBe(moonlightManor.strings.length - 1);
});

test("a language and a state together mean that state in that language", () => {
  const { db, p } = withHistory();
  expect(
    listCatalogue(db, p.id, { language: "en", states: ["verified"] }).rows,
  ).toEqual([]);
  expect(
    listCatalogue(db, p.id, {
      language: "pt-PT",
      states: ["verified"],
    }).rows.map((r) => r.stringId),
  ).toEqual(["skin.heard-nothing"]);
});
