import { moonlightManor, type QueuesResponse } from "@corpus/contract";
import { expect, test, vi } from "vitest";
import { agentDraft } from "@/agents/draft";
import {
  CONTINUE,
  FIXTURE,
  personSaves,
  pushedProject,
} from "@/agents/test-helpers";
import { applySnapshot } from "@/ingest/apply";

const seeded = pushedProject();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => seeded.db,
}));

const { GET } = await import("./route");

function queues(token: string | undefined, query = "") {
  return GET(
    new Request(`http://corpus.test/api/queues${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );
}

test("the queues need the project token", async () => {
  expect((await queues(undefined)).status).toBe(401);
  expect((await queues("nope")).status).toBe(401);
});

test("every queue, keyed by kind, with its items; a language narrows them", async () => {
  const { db, project, token, rui } = seeded;
  agentDraft(db, { project, key: CONTINUE, language: "en", text: "Continue" });
  personSaves(db, rui, "skin.heard-nothing", "en", "Nothing.");

  const all = (await (await queues(token)).json()) as QueuesResponse;
  expect(all.project).toBe("mm");
  expect(all.language).toBeNull();
  expect(Object.keys(all.queues)).toEqual([
    "untranslated",
    "stale",
    "unverifiedSource",
    "agentDrafts",
    "invalid",
  ]);
  expect(all.type).toBeNull();
  expect(all.queues.untranslated.items).toEqual([
    {
      key: "skin.seen-at-greenhouse-window",
      language: "en",
      type: "clue-skin",
      source: moonlightManor.strings[0]!.source,
      text: null,
    },
    {
      key: "ui.marks-left",
      language: "en",
      type: "chrome",
      source: moonlightManor.strings[3]!.source,
      text: null,
    },
  ]);
  expect(all.queues.agentDrafts).toEqual({
    count: 1,
    items: [
      {
        key: CONTINUE,
        language: "en",
        type: "chrome",
        source: "Continuar",
        text: "Continue",
      },
    ],
  });
  expect(all.queues.unverifiedSource.count).toBe(4);

  const en = (await (
    await queues(token, "?language=en")
  ).json()) as QueuesResponse;
  expect(en.language).toBe("en");
  expect(en.queues.unverifiedSource.count).toBe(0);
  expect(en.queues.untranslated.count).toBe(2);

  const fr = await queues(token, "?language=fr");
  expect(fr.status).toBe(422);
  expect((await fr.json()).error).toBe("unknown-language");

  const chrome = (await (
    await queues(token, "?type=chrome&language=pt-PT")
  ).json()) as QueuesResponse;
  expect(chrome.type).toBe("chrome");
  expect(chrome.queues.unverifiedSource.items).toEqual([
    {
      key: CONTINUE,
      language: "pt-PT",
      type: "chrome",
      source: "Continuar",
      // A source row holds no text of its own; the source is the string's.
      text: null,
    },
    {
      key: "ui.marks-left",
      language: "pt-PT",
      type: "chrome",
      source: moonlightManor.strings[3]!.source,
      text: null,
    },
  ]);
  const none = (await (
    await queues(token, "?type=nope")
  ).json()) as QueuesResponse;
  expect(none.queues.untranslated.count).toBe(0);
});

test("an untranslated row carries the repository's suggestion where it has one (#1050)", async () => {
  const { db, project, token } = seeded;
  applySnapshot(db, project.id, {
    ...FIXTURE,
    seedSuggestions: { "pt-PT": { "ui.marks-left": "Faltam {count}" } },
  });
  const body = (await (
    await queues(token, "?language=pt-PT")
  ).json()) as QueuesResponse;
  const items = body.queues.untranslated.items;
  expect(items.find((i) => i.key === "ui.marks-left")).toMatchObject({
    suggestion: "Faltam {count}",
  });
  expect(
    items
      .filter((i) => i.key !== "ui.marks-left")
      .every((i) => !("suggestion" in i)),
  ).toBe(true);
  expect(body.queues.agentDrafts.items[0]).not.toHaveProperty("suggestion");
  applySnapshot(db, project.id, FIXTURE);
});

test("an invalid seed is listed with what is wrong with it (#646)", async () => {
  const { db, project, token } = seeded;
  applySnapshot(db, project.id, {
    ...FIXTURE,
    seedTranslations: { en: { "ui.marks-left": "Left {zzz}" } },
  });
  const body = (await (
    await queues(token, "?language=en")
  ).json()) as QueuesResponse;
  expect(body.queues.invalid.items).toEqual([
    {
      key: "ui.marks-left",
      language: "en",
      type: "chrome",
      source: moonlightManor.strings[3]!.source,
      text: "Left {zzz}",
      problem: expect.stringContaining("Unexpected {zzz}"),
    },
  ]);
  expect(body.queues.agentDrafts.items[0]).not.toHaveProperty("problem");
  applySnapshot(db, project.id, FIXTURE);
});

test("an invalid printf seed's problem is read under its own library (#923)", async () => {
  const { db, project, token } = seeded;
  applySnapshot(db, project.id, {
    ...FIXTURE,
    strings: [
      ...FIXTURE.strings,
      {
        id: "ui.items %lld",
        type: "chrome",
        source: "%lld items",
        library: "printf",
        arguments: ["%lld"],
      },
    ],
    seedTranslations: { en: { "ui.items %lld": "%@ items" } },
  });
  const body = (await (
    await queues(token, "?language=en")
  ).json()) as QueuesResponse;
  // Read as ICU the seed is plain text, with nothing wrong with it.
  expect(
    body.queues.invalid.items.find((i) => i.key === "ui.items %lld")?.problem,
  ).toBe("%@ at position 1 where the source has %lld");
  applySnapshot(db, project.id, FIXTURE);
});
