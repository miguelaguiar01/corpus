import { moonlightManor, type Snapshot } from "@corpus/contract";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import type { Db } from "@/db";
import { projects, strings, users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "@/ingest/apply";
import { applyTransition } from "@/translations/service";
import { allQueues, queueCounts, queueItems } from "./queues";

const FIXTURE = moonlightManor as Snapshot;

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
  const [maintainer] = db
    .insert(users)
    .values({ name: "ana", maintainer: true })
    .returning()
    .all();
  if (!p || !maintainer) throw new Error("seed failed");
  applySnapshot(db, p.id, FIXTURE);
  return { db, p, maintainer };
}

function dbId(db: Db, stringId: string): number {
  const row = db
    .select()
    .from(strings)
    .where(eq(strings.stringId, stringId))
    .get();
  if (!row) throw new Error(`no string ${stringId}`);
  return row.id;
}

function item(db: Db, key: string, language: string) {
  return { stringId: dbId(db, key), key, language };
}

// Fixture order by insertion (= internal id): greenhouse, heard-nothing, ui.continue.
const IDS = FIXTURE.strings.map((s) => s.id);

test("after a first push: every target row is untranslated, every source row unverified, nothing stale", () => {
  const { db, p } = pushed();
  expect(queueCounts(db, p.id)).toEqual({
    untranslated: 3,
    stale: 0,
    unverifiedSource: 3,
  });
});

test("items are ordered by string id then language, and first is the head of the list", () => {
  const { db, p } = pushed();
  const queue = queueItems(db, p.id, "untranslated");
  expect(queue.items).toEqual(IDS.map((id) => item(db, id, "en")));
  expect(queue.first).toEqual(queue.items[0]);
  expect(queue.count).toBe(3);
});

test("unverified source lists source-language rows still in translated", () => {
  const { db, p, maintainer } = pushed();
  applyTransition(db, {
    stringId: dbId(db, IDS[0]!),
    language: "pt-PT",
    action: { type: "verify" },
    actor: maintainer,
  });
  const queue = queueItems(db, p.id, "unverifiedSource");
  expect(queue.items).toEqual(IDS.slice(1).map((id) => item(db, id, "pt-PT")));
  expect(queueCounts(db, p.id).unverifiedSource).toBe(2);
});

test("a saved target leaves the untranslated queue", () => {
  const { db, p, maintainer } = pushed();
  applyTransition(db, {
    stringId: dbId(db, IDS[1]!),
    language: "en",
    action: { type: "save", text: "Heard nothing." },
    actor: maintainer,
  });
  expect(queueItems(db, p.id, "untranslated").items).toEqual(
    [IDS[0], IDS[2]].map((id) => item(db, id!, "en")),
  );
});

test("stale lists rows marked by a push that changed the source", () => {
  const { db, p, maintainer } = pushed();
  applyTransition(db, {
    stringId: dbId(db, IDS[2]!),
    language: "en",
    action: { type: "save", text: "Continue" },
    actor: maintainer,
  });
  const changed: Snapshot = {
    ...FIXTURE,
    strings: FIXTURE.strings.map((s, i) =>
      i === 2 ? { ...s, source: s.source + "!" } : s,
    ),
  };
  applySnapshot(db, p.id, changed);
  const queue = queueItems(db, p.id, "stale");
  expect(queue.items).toEqual([item(db, IDS[2]!, "en")]);
  expect(queueCounts(db, p.id).stale).toBe(1);
});

test("archived strings are excluded from every queue", () => {
  const { db, p } = pushed();
  db.update(strings)
    .set({ archived: true })
    .where(eq(strings.id, dbId(db, IDS[0]!)))
    .run();
  expect(queueCounts(db, p.id)).toEqual({
    untranslated: 2,
    stale: 0,
    unverifiedSource: 2,
  });
  expect(
    queueItems(db, p.id, "untranslated").items.map((i) => i.stringId),
  ).not.toContain(dbId(db, IDS[0]!));
});

test("an empty queue has count 0 and no first item", () => {
  const { db, p } = pushed();
  expect(queueItems(db, p.id, "stale")).toEqual({
    kind: "stale",
    count: 0,
    first: null,
    items: [],
  });
});

test("queues are scoped to the project", () => {
  const { db } = pushed();
  const [other] = db
    .insert(projects)
    .values({ slug: "o", name: "O", sourceLanguage: "en", languages: ["en"] })
    .returning()
    .all();
  expect(queueCounts(db, other!.id)).toEqual({
    untranslated: 0,
    stale: 0,
    unverifiedSource: 0,
  });
});

test("allQueues returns every queue keyed by kind from one load", () => {
  const { db, p } = pushed();
  const all = allQueues(db, p.id);
  expect(Object.keys(all).sort()).toEqual([
    "stale",
    "untranslated",
    "unverifiedSource",
  ]);
  expect(all.untranslated).toEqual(queueItems(db, p.id, "untranslated"));
  expect(all.stale.count).toBe(0);
  expect(all.unverifiedSource.first).toEqual(item(db, IDS[0]!, "pt-PT"));
});
