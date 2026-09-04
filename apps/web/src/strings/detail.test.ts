import { moonlightManor, type Snapshot } from "@corpus/contract";
import { expect, test } from "vitest";
import { projects, users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "@/ingest/apply";
import { applyTransition } from "@/translations/service";
import { stringDetail } from "./detail";

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
  const [ana] = db
    .insert(users)
    .values({ name: "ana", maintainer: true })
    .returning()
    .all();
  if (!p || !ana) throw new Error("seed failed");
  applySnapshot(db, p.id, FIXTURE);
  return { db, p, ana };
}

test("returns the string with its source, type, metadata, and examples", () => {
  const { db, p } = pushed();
  const detail = stringDetail(db, p.id, "skin.seen-at-greenhouse-window");
  expect(detail?.string).toMatchObject({
    key: "skin.seen-at-greenhouse-window",
    type: "clue-skin",
    archived: false,
  });
  expect(detail?.string.source).toContain("foi");
  expect(detail?.string.metadata?.kind).toBe("sighting");
  expect(detail?.string.examples).toHaveLength(2);
});

test("carries the declarations for the string's own type", () => {
  const { db, p } = pushed();
  const detail = stringDetail(db, p.id, "skin.seen-at-greenhouse-window");
  expect(detail?.declarations.kind?.type).toBe("enum");
  expect(detail?.declarations.mentions?.type).toBe("list<ref>");
});

test("resolves ref and list<ref> metadata to entity cards with type labels", () => {
  const { db, p } = pushed();
  const detail = stringDetail(db, p.id, "skin.seen-at-greenhouse-window");
  expect(detail?.entities.map((e) => e.entityId)).toEqual([
    "trait:insomnia",
    "character:condessa-rosa",
    "character:doutor-vaz",
  ]);
  expect(detail?.entities[0]).toMatchObject({
    field: "requires_trait",
    typeLabel: "Trait",
    name: "Insónia",
  });
  expect(detail?.entities[0]?.attributes?.summary).toBeTruthy();
});

test("a ref to a missing entity is dropped, not thrown", () => {
  const { db, p } = pushed();
  const detail = stringDetail(db, p.id, "skin.heard-nothing");
  expect(detail?.entities).toEqual([]);
});

test("per-language rows carry state, stale, and version token", () => {
  const { db, p } = pushed();
  const detail = stringDetail(db, p.id, "ui.continue");
  expect(detail?.translations["pt-PT"]).toMatchObject({
    state: "translated",
    stale: false,
  });
  expect(typeof detail?.translations["pt-PT"]?.version).toBe("number");
  expect(detail?.translations["en"]?.state).toBe("untranslated");
});

test("history lists edits newest first with the actor's name", () => {
  const { db, p, ana } = pushed();
  const detail = stringDetail(db, p.id, "ui.continue");
  applyTransition(db, {
    stringId: detail!.string.id,
    language: "pt-PT",
    action: { type: "verify" },
    actor: ana,
  });
  applyTransition(db, {
    stringId: detail!.string.id,
    language: "en",
    action: { type: "save", text: "Continue" },
    actor: ana,
  });
  const after = stringDetail(db, p.id, "ui.continue");
  expect(
    after?.history.map((h) => [h.language, h.oldState, h.newState]),
  ).toEqual([
    ["en", "untranslated", "translated"],
    ["pt-PT", "translated", "verified"],
  ]);
  expect(after?.history[0]).toMatchObject({
    actor: "ana",
    newText: "Continue",
  });
  expect(after?.history[0]?.at).toBeInstanceOf(Date);
});

test("an unknown key or another project's key is undefined", () => {
  const { db, p } = pushed();
  expect(stringDetail(db, p.id, "nope")).toBeUndefined();
  expect(stringDetail(db, p.id + 1, "ui.continue")).toBeUndefined();
});
