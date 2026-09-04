import { moonlightManor, type Snapshot } from "@corpus/contract";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { projects, strings, users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "@/ingest/apply";
import { stringDetail } from "@/strings/detail";
import { applyTransition } from "@/translations/service";
import { pullPayload } from "./payload";

const FIXTURE = moonlightManor as Snapshot;
const [GREENHOUSE, HEARD, CONTINUE] = FIXTURE.strings.map((s) => s.id) as [
  string,
  string,
  string,
];

function pushed() {
  const db = memoryDb();
  const [p] = db
    .insert(projects)
    .values({
      slug: "moonlight-manor",
      name: "Moonlight Manor",
      sourceLanguage: "pt-PT",
      languages: ["pt-PT", "en"],
    })
    .returning()
    .all();
  const [ana] = db
    .insert(users)
    .values({ name: "ana", maintainer: true })
    .returning()
    .all();
  if (!p || !ana) throw new Error("seed failed");
  applySnapshot(db, p.id, FIXTURE);
  const id = (key: string) => stringDetail(db, p.id, key)!.string.id;
  applyTransition(db, {
    stringId: id(CONTINUE),
    language: "en",
    action: { type: "save", text: "Continue" },
    actor: ana,
  });
  applyTransition(db, {
    stringId: id(HEARD),
    language: "en",
    action: { type: "save", text: "Heard nothing." },
    actor: ana,
  });
  applyTransition(db, {
    stringId: id(HEARD),
    language: "en",
    action: { type: "verify" },
    actor: ana,
  });
  applyTransition(db, {
    stringId: id(GREENHOUSE),
    language: "pt-PT",
    action: { type: "verify" },
    actor: ana,
  });
  return { db, p, id };
}

test("at untranslated, every row with text is included: the whole source and any target text", () => {
  const { db, p } = pushed();
  const payload = pullPayload(db, p, "untranslated");
  expect(payload).toMatchObject({
    contract: "corpus/1",
    project: "moonlight-manor",
    sourceLanguage: "pt-PT",
    minState: "untranslated",
  });
  expect(Object.keys(payload.translations["pt-PT"]!).sort()).toEqual(
    [GREENHOUSE, HEARD, CONTINUE].sort(),
  );
  expect(payload.translations["pt-PT"]![GREENHOUSE]).toBe(
    FIXTURE.strings[0]!.source,
  );
  expect(payload.translations["en"]).toEqual({
    [CONTINUE]: "Continue",
    [HEARD]: "Heard nothing.",
  });
  expect(payload.types).toEqual({
    [GREENHOUSE]: "clue-skin",
    [HEARD]: "clue-skin",
    [CONTINUE]: "chrome",
  });
});

test("at translated, untranslated rows drop out and the source stays", () => {
  const { db, p } = pushed();
  const payload = pullPayload(db, p, "translated");
  expect(Object.keys(payload.translations["pt-PT"]!)).toHaveLength(3);
  expect(payload.translations["en"]).toEqual({
    [CONTINUE]: "Continue",
    [HEARD]: "Heard nothing.",
  });
});

test("at verified (the default), only verified rows remain, source included", () => {
  const { db, p } = pushed();
  const payload = pullPayload(db, p, "verified");
  expect(payload.translations["pt-PT"]).toEqual({
    [GREENHOUSE]: FIXTURE.strings[0]!.source,
  });
  expect(payload.translations["en"]).toEqual({ [HEARD]: "Heard nothing." });
});

test("every configured language is present even when it has nothing to pull", () => {
  const { db, p } = pushed();
  db.update(projects)
    .set({ languages: ["pt-PT", "en", "fr"] })
    .where(eq(projects.id, p.id))
    .run();
  const payload = pullPayload(
    db,
    { ...p, languages: ["pt-PT", "en", "fr"] },
    "verified",
  );
  expect(payload.translations["fr"]).toEqual({});
});

test("archived strings are excluded", () => {
  const { db, p, id } = pushed();
  db.update(strings)
    .set({ archived: true })
    .where(eq(strings.id, id(HEARD)))
    .run();
  const payload = pullPayload(db, p, "untranslated");
  expect(payload.translations["en"]).toEqual({ [CONTINUE]: "Continue" });
  expect(payload.types[HEARD]).toBeUndefined();
});
