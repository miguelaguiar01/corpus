import { moonlightManor, type Snapshot } from "@corpus/contract";
import { expect, test } from "vitest";
import { applySnapshot } from "@/ingest/apply";
import { projects, strings } from "./schema";
import { searchStringIds } from "./search";
import { memoryDb } from "./test-helpers";

function project(db = memoryDb(), langs = ["pt-PT", "en"]) {
  const [p] = db
    .insert(projects)
    .values({
      slug: "mm",
      name: "MM",
      sourceLanguage: "pt-PT",
      languages: langs,
    })
    .returning()
    .all();
  if (!p) throw new Error("seed failed");
  return { db, p };
}

function insert(
  db: ReturnType<typeof memoryDb>,
  projectId: number,
  id: string,
  source: string,
) {
  return db
    .insert(strings)
    .values({ projectId, stringId: id, type: "t", source })
    .returning()
    .get();
}

test("search is case- and accent-insensitive", () => {
  const { db, p } = project();
  const row = insert(
    db,
    p.id,
    "s1",
    "A Condessa Rosa foi vista à janela da estufa",
  );
  for (const q of ["condessa", "CONDESSA", "estufa", "ESTUFA", "rosa"]) {
    expect(searchStringIds(db, p.id, q), q).toContain(row.id);
  }
});

test("an accented source word matches an unaccented query", () => {
  const { db, p } = project();
  const row = insert(db, p.id, "s1", "e não estava sozinha");
  expect(searchStringIds(db, p.id, "nao")).toContain(row.id);
});

test("results are scoped to the project", () => {
  const { db, p } = project();
  const [other] = db
    .insert(projects)
    .values({ slug: "o", name: "O", sourceLanguage: "en", languages: ["en"] })
    .returning()
    .all();
  if (!other) throw new Error("seed failed");
  const mine = insert(db, p.id, "s1", "janela azul");
  insert(db, other.id, "s2", "janela verde");
  const hits = searchStringIds(db, p.id, "janela");
  expect(hits).toEqual([mine.id]);
});

test("archived strings are excluded", () => {
  const { db, p } = project();
  const row = insert(db, p.id, "s1", "estufa secreta");
  expect(searchStringIds(db, p.id, "estufa")).toContain(row.id);
  db.update(strings).set({ archived: true }).run();
  expect(searchStringIds(db, p.id, "estufa")).toEqual([]);
});

test("an empty query matches nothing", () => {
  const { db, p } = project();
  insert(db, p.id, "s1", "anything");
  expect(searchStringIds(db, p.id, "   ")).toEqual([]);
});

test("ingest keeps the index in sync (push then search finds strings)", () => {
  const { db, p } = project();
  applySnapshot(db, p.id, moonlightManor as Snapshot);
  const hits = searchStringIds(db, p.id, "janela");
  expect(hits.length).toBeGreaterThan(0);
});

test("a source change updates the index (new word matches)", () => {
  const { db, p } = project();
  applySnapshot(db, p.id, moonlightManor as Snapshot);
  const changed = structuredClone(moonlightManor) as Snapshot;
  changed.strings[0]!.source = "uma palavra inventada zorbulax";
  applySnapshot(db, p.id, changed);
  expect(searchStringIds(db, p.id, "zorbulax").length).toBe(1);
});
