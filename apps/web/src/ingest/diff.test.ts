import { expect, test } from "vitest";
import { diffSnapshot, type CurrentString } from "./diff";

const LANGS = { sourceLanguage: "pt-PT", targetLanguages: ["en"] };

function current(overrides: Partial<CurrentString> = {}): CurrentString {
  return {
    stringId: "s1",
    source: "original",
    archived: false,
    translatedTargets: ["en"],
    ...overrides,
  };
}

test("new id → insert; nothing else touched", () => {
  const plan = diffSnapshot(LANGS, [], [{ id: "s1", source: "hello" }]);
  expect(plan.insert).toEqual(["s1"]);
  expect(plan.report).toMatchObject({
    added: 1,
    changed: 0,
    stale: 0,
    archived: 0,
  });
});

test("same id, unchanged source → refresh only, no state changes", () => {
  const plan = diffSnapshot(
    LANGS,
    [current({ source: "hello" })],
    [{ id: "s1", source: "hello" }],
  );
  expect(plan.refresh).toEqual(["s1"]);
  expect(plan.updateSource).toEqual([]);
  expect(plan.report).toMatchObject({ added: 0, changed: 0, stale: 0 });
});

test("same id, changed source → update, stale every translated target, reset source state", () => {
  const plan = diffSnapshot(
    LANGS,
    [current({ source: "old", translatedTargets: ["en", "fr"] })],
    [{ id: "s1", source: "new" }],
  );
  expect(plan.updateSource).toEqual(["s1"]);
  expect(plan.refresh).toEqual([]);
  // stale = the two target rows in translated or verified
  expect(plan.report).toMatchObject({ changed: 1, stale: 2 });
});

test("id absent from snapshot → archive", () => {
  const plan = diffSnapshot(LANGS, [current()], []);
  expect(plan.archive).toEqual(["s1"]);
  expect(plan.report.archived).toBe(1);
});

test("already-archived id absent again → not re-archived", () => {
  const plan = diffSnapshot(LANGS, [current({ archived: true })], []);
  expect(plan.archive).toEqual([]);
  expect(plan.report.archived).toBe(0);
});

test("archived id returning, unchanged source → unarchive + refresh", () => {
  const plan = diffSnapshot(
    LANGS,
    [current({ archived: true, source: "hello" })],
    [{ id: "s1", source: "hello" }],
  );
  expect(plan.unarchive).toEqual(["s1"]);
  expect(plan.refresh).toEqual(["s1"]);
  expect(plan.updateSource).toEqual([]);
  expect(plan.report).toMatchObject({ unarchived: 1, stale: 0 });
});

test("archived id returning, changed source → unarchive + update + stale", () => {
  const plan = diffSnapshot(
    LANGS,
    [current({ archived: true, source: "old", translatedTargets: ["en"] })],
    [{ id: "s1", source: "new" }],
  );
  expect(plan.unarchive).toEqual(["s1"]);
  expect(plan.updateSource).toEqual(["s1"]);
  expect(plan.report).toMatchObject({ unarchived: 1, changed: 1, stale: 1 });
});

test("a string with no translated target rows contributes zero stale on source change", () => {
  const plan = diffSnapshot(
    LANGS,
    [current({ source: "old", translatedTargets: [] })],
    [{ id: "s1", source: "new" }],
  );
  expect(plan.report).toMatchObject({ changed: 1, stale: 0 });
});

test("a source that was the empty string takes its text as an update with no stale mark, counted apart (#620)", () => {
  const plan = diffSnapshot(
    LANGS,
    [current({ source: "", translatedTargets: ["en", "fr"] })],
    [{ id: "s1", source: "s1" }],
  );
  expect(plan.updateSource).toEqual(["s1"]);
  expect(plan.fromEmpty).toEqual(["s1"]);
  expect(plan.report).toMatchObject({ changed: 1, stale: 0, fromEmpty: 1 });
});

test("mixed snapshot classifies each id independently", () => {
  const plan = diffSnapshot(
    LANGS,
    [
      current({ stringId: "keep", source: "x" }),
      current({ stringId: "change", source: "old" }),
      current({ stringId: "gone", source: "y" }),
    ],
    [
      { id: "keep", source: "x" },
      { id: "change", source: "new" },
      { id: "fresh", source: "z" },
    ],
  );
  expect(plan.insert).toEqual(["fresh"]);
  expect(plan.refresh).toEqual(["keep"]);
  expect(plan.updateSource).toEqual(["change"]);
  expect(plan.archive).toEqual(["gone"]);
  expect(plan.report).toMatchObject({
    added: 1,
    changed: 1,
    archived: 1,
    stale: 1,
  });
});

// Seed import (§8) applies only to string×language with no existing Corpus
// edit history; the edit log itself lands in M2/M3, so the actual
// application is M3. Encoded here as intent.
test.todo(
  "seedTranslations import ignores string×language with edit history (M3)",
);
