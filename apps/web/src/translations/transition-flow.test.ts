import { moonlightManor, type Snapshot } from "@corpus/contract";
import { expect, test } from "vitest";
import { queueCounts } from "@/catalogue/queues";
import { projects, users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "@/ingest/apply";
import { stringDetail } from "@/strings/detail";
import { transitionFlow, verifyFlow } from "./transition-flow";

const FIXTURE = moonlightManor as Snapshot;
const KEYS = FIXTURE.strings.map((s) => s.id);

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
  const [rui] = db
    .insert(users)
    .values({ name: "rui", maintainer: false })
    .returning()
    .all();
  if (!p || !ana || !rui) throw new Error("seed failed");
  applySnapshot(db, p.id, FIXTURE);
  return { db, p, ana, rui };
}

function versionOfSource(
  db: ReturnType<typeof memoryDb>,
  projectId: number,
  key: string,
) {
  return stringDetail(db, projectId, key)!.translations["pt-PT"]!.version;
}

test("a maintainer verifying from the queue moves on to the next item", () => {
  const { db, p, ana } = pushed();
  const result = verifyFlow(db, {
    project: p,
    user: ana,
    key: KEYS[0]!,
    queue: "unverifiedSource",
    openedVersion: versionOfSource(db, p.id, KEYS[0]!),
  });
  expect(result).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[1]!)}?queue=unverifiedSource&language=pt-PT`,
  });
  expect(stringDetail(db, p.id, KEYS[0]!)?.translations["pt-PT"]?.state).toBe(
    "verified",
  );
  expect(queueCounts(db, p.id).unverifiedSource).toBe(2);
});

test("verifying the last item in the queue returns to the dashboard", () => {
  const { db, p, ana } = pushed();
  const result = verifyFlow(db, {
    project: p,
    user: ana,
    key: KEYS[2]!,
    queue: "unverifiedSource",
  });
  expect(result).toEqual({ kind: "redirect", to: "/p/mm" });
});

test("without a queue, verifying stays on the string", () => {
  const { db, p, ana } = pushed();
  const result = verifyFlow(db, { project: p, user: ana, key: KEYS[1]! });
  expect(result).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[1]!)}`,
  });
});

test("a non-maintainer is rejected server-side and sent back with the error", () => {
  const { db, p, rui } = pushed();
  const result = verifyFlow(db, {
    project: p,
    user: rui,
    key: KEYS[0]!,
    queue: "unverifiedSource",
  });
  expect(result).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[0]!)}?queue=unverifiedSource&language=pt-PT&error=not-maintainer`,
  });
  expect(stringDetail(db, p.id, KEYS[0]!)?.translations["pt-PT"]?.state).toBe(
    "translated",
  );
});

test("a stale version token still applies but stays on the string with a warning", () => {
  const { db, p, ana } = pushed();
  const stale = versionOfSource(db, p.id, KEYS[0]!) - 60_000;
  const result = verifyFlow(db, {
    project: p,
    user: ana,
    key: KEYS[0]!,
    queue: "unverifiedSource",
    openedVersion: stale,
  });
  expect(result).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[0]!)}?queue=unverifiedSource&language=pt-PT&warning=changed`,
  });
  expect(stringDetail(db, p.id, KEYS[0]!)?.translations["pt-PT"]?.state).toBe(
    "verified",
  );
});

test("an unknown key is not found", () => {
  const { db, p, ana } = pushed();
  expect(verifyFlow(db, { project: p, user: ana, key: "nope" })).toEqual({
    kind: "not-found",
  });
});

function textOf(
  db: ReturnType<typeof memoryDb>,
  projectId: number,
  key: string,
  language: string,
) {
  return stringDetail(db, projectId, key)!.translations[language];
}

test("a valid save transitions the target row, logs one edit, and moves to the next queue item", () => {
  const { db, p, rui } = pushed();
  const result = transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[1]!,
    language: "en",
    action: { type: "save", text: "Heard nothing all night." },
    queue: "untranslated",
  });
  expect(result).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[2]!)}?queue=untranslated&language=en`,
  });
  expect(textOf(db, p.id, KEYS[1]!, "en")).toMatchObject({
    state: "translated",
    text: "Heard nothing all night.",
  });
  expect(stringDetail(db, p.id, KEYS[1]!)?.history).toHaveLength(1);
});

test("an invalid save is rejected server-side: row unchanged, nothing logged, error carried back", () => {
  const { db, p, rui } = pushed();
  const before = textOf(db, p.id, KEYS[0]!, "en");
  const result = transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[0]!,
    language: "en",
    action: { type: "save", text: "Someone was seen at the window." },
    queue: "untranslated",
  });
  expect(result).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[0]!)}?queue=untranslated&language=en&error=invalid-translation`,
  });
  expect(textOf(db, p.id, KEYS[0]!, "en")).toEqual(before);
  expect(stringDetail(db, p.id, KEYS[0]!)?.history).toHaveLength(0);
});

test("verify on a target row is maintainer-only", () => {
  const { db, p, ana, rui } = pushed();
  transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[2]!,
    language: "en",
    action: { type: "save", text: "Continue" },
  });
  const denied = transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[2]!,
    language: "en",
    action: { type: "verify" },
  });
  expect(denied).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[2]!)}?error=not-maintainer`,
  });
  const allowed = transitionFlow(db, {
    project: p,
    user: ana,
    key: KEYS[2]!,
    language: "en",
    action: { type: "verify" },
  });
  expect(allowed).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[2]!)}`,
  });
  expect(textOf(db, p.id, KEYS[2]!, "en")?.state).toBe("verified");
});

test("a save with a stale version token still applies but stays on the string with the warning", () => {
  const { db, p, rui } = pushed();
  const stale = textOf(db, p.id, KEYS[2]!, "en")!.version - 60_000;
  const result = transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[2]!,
    language: "en",
    action: { type: "save", text: "Continue" },
    queue: "untranslated",
    openedVersion: stale,
  });
  expect(result).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[2]!)}?queue=untranslated&language=en&warning=changed`,
  });
  expect(textOf(db, p.id, KEYS[2]!, "en")?.text).toBe("Continue");
});

test("verifyFlow is the source-language verify case of transitionFlow", () => {
  const { db, p, ana } = pushed();
  expect(verifyFlow(db, { project: p, user: ana, key: KEYS[1]! })).toEqual(
    transitionFlow(db, {
      project: p,
      user: ana,
      key: KEYS[1]!,
      language: "pt-PT",
      action: { type: "verify" },
    }),
  );
});

test("a save aimed at the source language is rejected server-side", () => {
  const { db, p, rui } = pushed();
  const result = transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[2]!,
    language: "pt-PT",
    action: { type: "save", text: "Continuar!" },
  });
  expect(result).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[2]!)}?error=source-row`,
  });
  expect(stringDetail(db, p.id, KEYS[2]!)?.history).toHaveLength(0);
});

test("saving the same text again is a no-op transition that still moves on", () => {
  const { db, p, rui } = pushed();
  const save = () =>
    transitionFlow(db, {
      project: p,
      user: rui,
      key: KEYS[2]!,
      language: "en",
      action: { type: "save", text: "Continue" },
    });
  save();
  const result = save();
  expect(result).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[2]!)}`,
  });
  expect(stringDetail(db, p.id, KEYS[2]!)?.history).toHaveLength(2);
  expect(textOf(db, p.id, KEYS[2]!, "en")).toMatchObject({
    state: "translated",
    text: "Continue",
  });
});
