import { and, eq } from "drizzle-orm";
import { expect, test } from "vitest";
import type { Db } from "@/db";
import {
  edits,
  projects,
  strings,
  stringTranslations,
  users,
} from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applyTransition } from "./service";
import { versionOf } from "./version";

function seed(options: { archived?: boolean } = {}) {
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
      archived: options.archived ?? false,
    })
    .returning()
    .all();
  if (!string) throw new Error("seed failed");
  db.insert(stringTranslations)
    .values([
      {
        stringId: string.id,
        language: "pt-PT",
        text: string.source,
        state: "translated",
      },
      {
        stringId: string.id,
        language: "en",
        state: "untranslated",
        stale: true,
      },
    ])
    .run();
  const [maintainer] = db
    .insert(users)
    .values({ name: "ana", maintainer: true })
    .returning()
    .all();
  const [translator] = db
    .insert(users)
    .values({ name: "rui", maintainer: false })
    .returning()
    .all();
  if (!maintainer || !translator) throw new Error("seed failed");
  return { db, string, maintainer, translator };
}

function translation(db: Db, stringId: number, language: string) {
  return db
    .select()
    .from(stringTranslations)
    .where(
      and(
        eq(stringTranslations.stringId, stringId),
        eq(stringTranslations.language, language),
      ),
    )
    .get();
}

test("save transitions the row and logs exactly one edit with old → new", () => {
  const { db, string, translator } = seed();
  const result = applyTransition(db, {
    stringId: string.id,
    language: "en",
    action: { type: "save", text: "Seen at the window." },
    actor: translator,
  });
  expect(result).toMatchObject({
    row: { state: "translated", text: "Seen at the window.", stale: false },
    edit: {
      stringId: string.id,
      language: "en",
      userId: translator.id,
      oldText: null,
      newText: "Seen at the window.",
      oldState: "untranslated",
      newState: "translated",
    },
  });
  expect(translation(db, string.id, "en")).toMatchObject({
    state: "translated",
    text: "Seen at the window.",
    stale: false,
  });
  expect(db.select().from(edits).all()).toHaveLength(1);
});

test("verify by a maintainer transitions the source row and logs the sign-off", () => {
  const { db, string, maintainer } = seed();
  const result = applyTransition(db, {
    stringId: string.id,
    language: "pt-PT",
    action: { type: "verify" },
    actor: maintainer,
  });
  expect(result).toMatchObject({
    row: { state: "verified", stale: false },
    edit: {
      userId: maintainer.id,
      oldText: string.source,
      newText: string.source,
      oldState: "translated",
      newState: "verified",
    },
  });
  expect(translation(db, string.id, "pt-PT")?.state).toBe("verified");
});

test("a transition bumps updatedAt", () => {
  const { db, string, maintainer } = seed();
  const before = translation(db, string.id, "pt-PT")!.updatedAt;
  db.update(stringTranslations)
    .set({ updatedAt: new Date(before.getTime() - 60_000) })
    .run();
  applyTransition(db, {
    stringId: string.id,
    language: "pt-PT",
    action: { type: "verify" },
    actor: maintainer,
  });
  expect(
    translation(db, string.id, "pt-PT")!.updatedAt.getTime(),
  ).toBeGreaterThan(before.getTime() - 60_000);
});

test("a rejected verify by a non-maintainer writes nothing", () => {
  const { db, string, translator } = seed();
  const before = translation(db, string.id, "pt-PT");
  const result = applyTransition(db, {
    stringId: string.id,
    language: "pt-PT",
    action: { type: "verify" },
    actor: translator,
  });
  expect(result).toEqual({ error: "not-maintainer" });
  expect(translation(db, string.id, "pt-PT")).toEqual(before);
  expect(db.select().from(edits).all()).toHaveLength(0);
});

test("an archived string's rows reject save and verify", () => {
  const { db, string, maintainer } = seed({ archived: true });
  const save = applyTransition(db, {
    stringId: string.id,
    language: "en",
    action: { type: "save", text: "x" },
    actor: maintainer,
  });
  const verify = applyTransition(db, {
    stringId: string.id,
    language: "pt-PT",
    action: { type: "verify" },
    actor: maintainer,
  });
  expect(save).toEqual({ error: "archived" });
  expect(verify).toEqual({ error: "archived" });
  expect(db.select().from(edits).all()).toHaveLength(0);
});

test("a missing string × language row is a typed rejection", () => {
  const { db, string, maintainer } = seed();
  const result = applyTransition(db, {
    stringId: string.id,
    language: "fr",
    action: { type: "save", text: "x" },
    actor: maintainer,
  });
  expect(result).toEqual({ error: "not-found" });
});

test("row update and edit insert are atomic: a failing log entry rolls back the row", () => {
  const { db, string, maintainer } = seed();
  const ghost = { ...maintainer, id: 999 };
  expect(() =>
    applyTransition(db, {
      stringId: string.id,
      language: "pt-PT",
      action: { type: "verify" },
      actor: ghost,
    }),
  ).toThrow(/FOREIGN KEY/);
  expect(translation(db, string.id, "pt-PT")?.state).toBe("translated");
  expect(db.select().from(edits).all()).toHaveLength(0);
});

test("a current version token applies and reports no concurrent edit", () => {
  const { db, string, maintainer } = seed();
  const opened = versionOf(translation(db, string.id, "pt-PT")!);
  const result = applyTransition(db, {
    stringId: string.id,
    language: "pt-PT",
    action: { type: "verify" },
    actor: maintainer,
    openedVersion: opened,
  });
  expect(result).toMatchObject({
    row: { state: "verified" },
    changedSinceOpened: false,
  });
});

test("a stale version token still applies (last write wins) but is flagged", () => {
  const { db, string, translator } = seed();
  const opened = versionOf(translation(db, string.id, "pt-PT")!);
  db.update(stringTranslations)
    .set({ updatedAt: new Date(opened + 60_000) })
    .where(eq(stringTranslations.stringId, string.id))
    .run();
  const result = applyTransition(db, {
    stringId: string.id,
    language: "pt-PT",
    action: { type: "save", text: "Foi visto à janela." },
    actor: translator,
    openedVersion: opened,
  });
  expect(result).toMatchObject({
    row: { state: "translated", text: "Foi visto à janela." },
    changedSinceOpened: true,
  });
  expect(translation(db, string.id, "pt-PT")?.text).toBe("Foi visto à janela.");
});

test("without a token the result never warns", () => {
  const { db, string, maintainer } = seed();
  const result = applyTransition(db, {
    stringId: string.id,
    language: "pt-PT",
    action: { type: "verify" },
    actor: maintainer,
  });
  expect(result).toMatchObject({ changedSinceOpened: false });
});
