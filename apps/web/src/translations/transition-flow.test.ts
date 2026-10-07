import { moonlightManor, type Snapshot } from "@corpus/contract";
import { afterEach, expect, test, vi } from "vitest";
import { queueCounts } from "@/catalogue/queues";
import { eq } from "drizzle-orm";
import { projects, strings, users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "@/ingest/apply";
import { stringDetail } from "@/strings/detail";
import { carriedFrom } from "./carried";
import { sourceStamp } from "./stamp";
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
  expect(queueCounts(db, p.id).unverifiedSource).toBe(3);
});

test("verifying the last item in the queue returns to the dashboard", () => {
  const { db, p, ana } = pushed();
  const result = verifyFlow(db, {
    project: p,
    user: ana,
    key: KEYS[3]!,
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
    // The draft rides back so the pane can name the fault (#529).
    to: `/p/mm/s/${encodeURIComponent(KEYS[0]!)}?queue=untranslated&language=en&error=invalid-translation&draft=Someone+was+seen+at+the+window.`,
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
    to: `/p/mm/s/${encodeURIComponent(KEYS[2]!)}?language=en&error=not-maintainer`,
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

test("a source that moved under the draft is named and the draft kept; a refused draft rides back too (#529)", () => {
  const { db, p, rui } = pushed();
  const before = textOf(db, p.id, KEYS[0]!, "en");
  const stale = sourceStamp("what the page showed");
  const moved = transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[0]!,
    language: "en",
    action: { type: "save", text: "Someone was seen at the window." },
    openedSource: stale,
  });
  expect(moved).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[0]!)}?language=en&warning=source-changed&draft=Someone+was+seen+at+the+window.`,
  });
  expect(textOf(db, p.id, KEYS[0]!, "en")).toEqual(before);
  const refused = transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[0]!,
    language: "en",
    action: { type: "save", text: "Someone was seen at the window." },
    openedSource: sourceStamp(stringDetail(db, p.id, KEYS[0]!)!.string.source),
  });
  expect(refused).toMatchObject({ kind: "redirect" });
  expect((refused as { to: string }).to).toContain(
    "error=invalid-translation&draft=",
  );
});

afterEach(() => {
  vi.useRealTimers();
});

test("a refused save carries back the version the form opened, beside the draft (#1058)", () => {
  const { db, p, rui } = pushed();
  const opened = textOf(db, p.id, KEYS[2]!, "en")!.version;
  const refused = transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[2]!,
    language: "en",
    action: { type: "save", text: "Continue {x}" },
    queue: "untranslated",
    openedVersion: opened,
  });
  expect(refused).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[2]!)}?queue=untranslated&language=en&error=invalid-translation&draft=Continue+%7Bx%7D&opened=${opened}`,
  });
  const moved = transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[2]!,
    language: "en",
    action: { type: "save", text: "Continue" },
    openedVersion: opened,
    openedSource: sourceStamp("what the page showed"),
  });
  expect(moved).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[2]!)}?language=en&warning=source-changed&draft=Continue&opened=${opened}`,
  });
});

test("a save after a refused one still warns of an edit made since the string was opened (#1058)", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
  const { db, p, ana, rui } = pushed();
  // Ana opens the string at its version now.
  const opened = textOf(db, p.id, KEYS[2]!, "en")!.version;
  // Bea (rui here) saves meanwhile.
  vi.setSystemTime(new Date("2026-10-06T10:01:00Z"));
  transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[2]!,
    language: "en",
    action: { type: "save", text: "Go on" },
    openedVersion: opened,
  });
  vi.setSystemTime(new Date("2026-10-06T10:02:00Z"));
  const refused = transitionFlow(db, {
    project: p,
    user: ana,
    key: KEYS[2]!,
    language: "en",
    action: { type: "save", text: "Continue {x}" },
    openedVersion: opened,
  });
  // The page the refusal lands on opens the pane at what it carried.
  const query = Object.fromEntries(
    new URL((refused as { to: string }).to, "http://corpus.example")
      .searchParams,
  );
  const now = textOf(db, p.id, KEYS[2]!, "en")!.version;
  expect(now).not.toBe(opened);
  const carried = carriedFrom(query, now);
  expect(carried).toEqual({ draft: "Continue {x}", openedVersion: opened });
  const saved = transitionFlow(db, {
    project: p,
    user: ana,
    key: KEYS[2]!,
    language: "en",
    action: { type: "save", text: "Continue" },
    openedVersion: carried.openedVersion,
  });
  expect(saved).toEqual({
    kind: "redirect",
    // Outside a queue the refusal stays on the language saved in.
    to: `/p/mm/s/${encodeURIComponent(KEYS[2]!)}?language=en&warning=changed`,
  });
});

test("a save giving two texts to the exact keys one gettext form is read by is refused with the draft (#1060)", () => {
  const { db, p, rui } = pushed();
  db.update(strings)
    .set({
      pluralForms: { en: ["=0", "=1", "other"] },
      pluralShared: { en: [["=0", "=1"]] },
      // A gettext plural, which is on count.
      source: "{count, plural, one {# mark left.} other {# marks left.}}",
    })
    .where(eq(strings.stringId, KEYS[3]!))
    .run();
  const result = transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[3]!,
    language: "en",
    action: {
      type: "save",
      text: "{count, plural, =0 {No marks left.} =1 {# mark left.} other {# marks left.}}",
    },
  });
  expect((result as { to: string }).to).toContain("error=invalid-translation");
});

test("a save writing an =N branch into a plural its file holds as forms is refused with the draft (#704)", () => {
  const { db, p, rui } = pushed();
  db.update(strings)
    .set({
      pluralAsForms: true,
      source: "{count, plural, one {{count} room} other {{count} rooms}}",
    })
    .where(eq(strings.stringId, KEYS[3]!))
    .run();
  const result = transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[3]!,
    language: "en",
    action: {
      type: "save",
      text: "{count, plural, =0 {No rooms} one {{count} room} other {{count} rooms}}",
    },
  });
  expect((result as { to: string }).to).toContain("error=invalid-translation");
});

test("a save writing an =0 branch into a counterpart plural is refused with the draft (#964)", () => {
  const { db, p, rui } = pushed();
  db.update(strings)
    .set({
      syntax: "counterpart",
      source: "{count, plural, one {%(count)s room} other {%(count)s rooms}}",
    })
    .where(eq(strings.stringId, KEYS[3]!))
    .run();
  const result = transitionFlow(db, {
    project: p,
    user: rui,
    key: KEYS[3]!,
    language: "en",
    action: {
      type: "save",
      text: "{count, plural, =0 {No rooms} one {%(count)s room} other {%(count)s rooms}}",
    },
  });
  expect((result as { to: string }).to).toContain("error=invalid-translation");
});
