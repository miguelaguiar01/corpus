import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { strings, stringTranslations } from "@/db/schema";
import { stringDetail } from "@/strings/detail";
import { agentDraft } from "./draft";
import {
  CONTINUE,
  GREENHOUSE,
  HEARD,
  personSaves,
  personVerifies,
  pushedProject,
  stringRowId,
} from "./test-helpers";

test("a draft lands on an untranslated row as translated, attributed to the agent", () => {
  const { db, project } = pushedProject();
  const result = agentDraft(db, {
    project,
    key: CONTINUE,
    language: "en",
    text: "Continue",
  });
  expect(result).toEqual({
    ok: true,
    key: CONTINUE,
    language: "en",
    state: "translated",
    text: "Continue",
    actor: "mm agent",
  });
  const detail = stringDetail(db, project.id, CONTINUE)!;
  expect(detail.translations.en).toMatchObject({
    state: "translated",
    text: "Continue",
    agentDraft: true,
  });
  expect(detail.history[0]).toMatchObject({
    actor: "mm agent",
    agent: true,
    language: "en",
  });
});

test("a row a person saved is refused as human-edited, even untouched by the agent since", () => {
  const { db, project, rui } = pushedProject();
  personSaves(db, rui, CONTINUE, "en", "Continue");
  const result = agentDraft(db, {
    project,
    key: CONTINUE,
    language: "en",
    text: "Go on",
  });
  expect(result).toEqual({ ok: false, reason: "human-edited" });
  expect(stringDetail(db, project.id, CONTINUE)!.translations.en?.text).toBe(
    "Continue",
  );
});

test("the agent may redraft its own draft, and loses the row once a person verifies it", () => {
  const { db, project, ana } = pushedProject();
  agentDraft(db, { project, key: HEARD, language: "en", text: "Nothing." });
  const again = agentDraft(db, {
    project,
    key: HEARD,
    language: "en",
    text: "I heard nothing all night.",
  });
  expect(again.ok).toBe(true);
  personVerifies(db, ana, HEARD, "en");
  const after = agentDraft(db, {
    project,
    key: HEARD,
    language: "en",
    text: "Nothing at all.",
  });
  expect(after).toEqual({ ok: false, reason: "human-edited" });
});

test("a stale row is open to the agent; the person's text stays in the history", () => {
  const { db, project, rui } = pushedProject();
  personSaves(db, rui, CONTINUE, "en", "Continue");
  db.update(strings)
    .set({ source: "Prosseguir" })
    .where(eq(strings.id, stringRowId(db, CONTINUE)))
    .run();
  // A push that changed the source marks the row stale (§8).
  db.update(stringTranslations)
    .set({ stale: true })
    .where(eq(stringTranslations.stringId, stringRowId(db, CONTINUE)))
    .run();
  const result = agentDraft(db, {
    project,
    key: CONTINUE,
    language: "en",
    text: "Proceed",
  });
  expect(result.ok).toBe(true);
  const detail = stringDetail(db, project.id, CONTINUE)!;
  expect(detail.translations.en).toMatchObject({
    text: "Proceed",
    stale: false,
    agentDraft: true,
  });
  expect(detail.history.map((h) => [h.actor, h.newText])).toEqual([
    ["mm agent", "Proceed"],
    ["rui", "Continue"],
  ]);
});

test("a row push seeded with text has no edit and counts as a person's", () => {
  const { db, project } = pushedProject();
  db.update(stringTranslations)
    .set({ text: "Continue", state: "translated" })
    .where(eq(stringTranslations.stringId, stringRowId(db, CONTINUE)))
    .run();
  const result = agentDraft(db, {
    project,
    key: CONTINUE,
    language: "en",
    text: "Go on",
  });
  expect(result).toEqual({ ok: false, reason: "human-edited" });
});

test("the source row, an unknown language, an empty text and a lost placeholder are refused", () => {
  const { db, project } = pushedProject();
  const draft = (key: string, language: string, text: string) =>
    agentDraft(db, { project, key, language, text });
  expect(draft(CONTINUE, "pt-PT", "x")).toEqual({
    ok: false,
    reason: "source-row",
  });
  expect(draft(CONTINUE, "fr", "x")).toEqual({
    ok: false,
    reason: "unknown-language",
  });
  expect(draft(CONTINUE, "en", "   ")).toEqual({
    ok: false,
    reason: "empty-text",
  });
  const invalid = draft(GREENHOUSE, "en", "Someone was seen at the window.");
  expect(invalid).toMatchObject({ ok: false, reason: "invalid-translation" });
  expect(
    invalid.ok === false && "message" in invalid && invalid.message,
  ).toMatch(/\{person\}/);
  expect(draft("no.such", "en", "x")).toEqual({
    ok: false,
    reason: "not-found",
  });
});

test("a verified row that went stale is open to the agent", () => {
  const { db, project, rui, ana } = pushedProject();
  personSaves(db, rui, HEARD, "en", "Nothing.");
  personVerifies(db, ana, HEARD, "en");
  db.update(stringTranslations)
    .set({ stale: true })
    .where(eq(stringTranslations.stringId, stringRowId(db, HEARD)))
    .run();
  const result = agentDraft(db, {
    project,
    key: HEARD,
    language: "en",
    text: "I heard nothing.",
  });
  expect(result.ok).toBe(true);
  expect(stringDetail(db, project.id, HEARD)!.translations.en).toMatchObject({
    state: "translated",
    stale: false,
    agentDraft: true,
  });
});
