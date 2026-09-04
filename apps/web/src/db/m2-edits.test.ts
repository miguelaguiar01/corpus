import { desc, eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { edits, projects, strings, users } from "./schema";
import { memoryDb } from "./test-helpers";

function seed() {
  const db = memoryDb();
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
  const [string] = db
    .insert(strings)
    .values({
      projectId: project!.id,
      stringId: "skin.seen",
      type: "clue-skin",
      source: "{person} foi visto.",
    })
    .returning()
    .all();
  const [user] = db
    .insert(users)
    .values({ name: "ana", maintainer: true })
    .returning()
    .all();
  if (!string || !user) throw new Error("seed failed");
  return { db, string, user };
}

test("an edit records who, when, string, language, and old → new text/state", () => {
  const { db, string, user } = seed();
  const [row] = db
    .insert(edits)
    .values({
      stringId: string.id,
      language: "en",
      userId: user.id,
      oldText: null,
      newText: "Seen at the window.",
      oldState: "untranslated",
      newState: "translated",
    })
    .returning()
    .all();
  expect(row).toMatchObject({
    stringId: string.id,
    language: "en",
    userId: user.id,
    oldText: null,
    newText: "Seen at the window.",
    oldState: "untranslated",
    newState: "translated",
  });
  expect(row?.at).toBeInstanceOf(Date);
});

test("history for a string × language reads back newest first", () => {
  const { db, string, user } = seed();
  const base = {
    stringId: string.id,
    language: "pt-PT",
    userId: user.id,
    oldText: "a",
    newText: "a",
  };
  db.insert(edits)
    .values({
      ...base,
      oldState: "translated",
      newState: "verified",
      at: new Date("2026-09-04T10:00:00Z"),
    })
    .run();
  db.insert(edits)
    .values({
      ...base,
      oldState: "verified",
      newState: "translated",
      at: new Date("2026-09-04T11:00:00Z"),
    })
    .run();
  const history = db
    .select({ newState: edits.newState })
    .from(edits)
    .where(eq(edits.stringId, string.id))
    .orderBy(desc(edits.at))
    .all();
  expect(history.map((e) => e.newState)).toEqual(["translated", "verified"]);
});

test("edit → string foreign key is enforced", () => {
  const { db, user } = seed();
  expect(() =>
    db
      .insert(edits)
      .values({
        stringId: 999,
        language: "en",
        userId: user.id,
        oldState: "untranslated",
        newState: "translated",
      })
      .run(),
  ).toThrow(/FOREIGN KEY/);
});

test("edit → user foreign key is enforced", () => {
  const { db, string } = seed();
  expect(() =>
    db
      .insert(edits)
      .values({
        stringId: string.id,
        language: "en",
        userId: 999,
        oldState: "untranslated",
        newState: "translated",
      })
      .run(),
  ).toThrow(/FOREIGN KEY/);
});
