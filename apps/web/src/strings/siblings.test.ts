import { moonlightManor, type Snapshot } from "@corpus/contract";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import type { Db } from "@/db";
import { projects, strings } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "@/ingest/apply";
import { nearest, siblingPrefix, siblingsOf } from "./siblings";

const FIXTURE = moonlightManor as Snapshot;

function pushed(snapshot: Snapshot = FIXTURE) {
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
  applySnapshot(db, p.id, snapshot);
  return { db, p };
}

function row(db: Db, key: string) {
  const found = db
    .select()
    .from(strings)
    .where(eq(strings.stringId, key))
    .get();
  if (!found) throw new Error(`no string ${key}`);
  return { id: found.id, key: found.stringId, type: found.type };
}

// Forty quips under one prefix, one stranger of another type under it,
// and one of the same type under another prefix.
function quips(): Snapshot {
  const entries = Array.from({ length: 40 }, (_, i) => ({
    id: `dossier.fail.${String(i).padStart(2, "0")}`,
    type: "chrome",
    source: `Quip ${i}`,
  }));
  return {
    ...FIXTURE,
    strings: [
      ...entries,
      { id: "dossier.fail.stranger", type: "clue-skin", source: "Not a quip" },
      { id: "dossier.win.0", type: "chrome", source: "Elsewhere" },
    ],
    entities: [],
  };
}

test("the prefix is the key up to its last dot; a dotless key has none", () => {
  expect(siblingPrefix("dossier.fail.0")).toBe("dossier.fail");
  expect(siblingPrefix("ui.continue")).toBe("ui");
  expect(siblingPrefix("varrer")).toBeNull();
});

test("siblings share the type and the prefix, exclude the string itself and archived ones", () => {
  const { db, p } = pushed();
  const greenhouse = siblingsOf(
    db,
    p.id,
    row(db, "skin.seen-at-greenhouse-window"),
  );
  expect(greenhouse.total).toBe(1);
  expect(greenhouse.items.map((s) => s.key)).toEqual(["skin.heard-nothing"]);
  expect(greenhouse.items[0]?.translations.en).toMatchObject({
    state: "untranslated",
    text: null,
  });
  expect(siblingsOf(db, p.id, row(db, "ui.continue"))).toEqual({
    total: 0,
    items: [],
  });
  db.update(strings)
    .set({ archived: true })
    .where(eq(strings.stringId, "skin.heard-nothing"))
    .run();
  expect(
    siblingsOf(db, p.id, row(db, "skin.seen-at-greenhouse-window")).total,
  ).toBe(0);
});

test("the ten nearest in key order, five before and five after, filled from the other side at the ends", () => {
  const { db, p } = pushed(quips());
  const keys = (key: string) =>
    siblingsOf(db, p.id, row(db, key)).items.map((s) => s.key.slice(-2));
  const middle = siblingsOf(db, p.id, row(db, "dossier.fail.20"));
  expect(middle.total).toBe(39);
  expect(keys("dossier.fail.20")).toEqual([
    "15",
    "16",
    "17",
    "18",
    "19",
    "21",
    "22",
    "23",
    "24",
    "25",
  ]);
  expect(keys("dossier.fail.00")).toEqual([
    "01",
    "02",
    "03",
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
    "10",
  ]);
  expect(keys("dossier.fail.39")).toEqual([
    "29",
    "30",
    "31",
    "32",
    "33",
    "34",
    "35",
    "36",
    "37",
    "38",
  ]);
  expect(keys("dossier.fail.02")).toEqual([
    "00",
    "01",
    "03",
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
    "10",
  ]);
});

test("a stranger of another type under the prefix and a same-type string under another prefix are not siblings", () => {
  const { db, p } = pushed(quips());
  const all = siblingsOf(db, p.id, row(db, "dossier.fail.20"));
  expect(all.total).toBe(39);
  expect(siblingsOf(db, p.id, row(db, "dossier.fail.stranger")).total).toBe(0);
  expect(siblingsOf(db, p.id, row(db, "dossier.win.0")).total).toBe(0);
});

test("nearest keeps everything when there are ten or fewer", () => {
  const few = [{ key: "a.1" }, { key: "a.3" }];
  expect(nearest(few, "a.2")).toEqual(few);
});
