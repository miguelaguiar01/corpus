import type { QueuesResponse } from "@corpus/contract";
import { expect, test, vi } from "vitest";
import { agentDraft } from "@/agents/draft";
import { CONTINUE, personSaves, pushedProject } from "@/agents/test-helpers";

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
  ]);
  expect(all.type).toBeNull();
  expect(all.queues.untranslated.items).toEqual([
    {
      key: "skin.seen-at-greenhouse-window",
      language: "en",
      type: "clue-skin",
    },
  ]);
  expect(all.queues.agentDrafts).toEqual({
    count: 1,
    items: [{ key: CONTINUE, language: "en", type: "chrome" }],
  });
  expect(all.queues.unverifiedSource.count).toBe(3);

  const en = (await (
    await queues(token, "?language=en")
  ).json()) as QueuesResponse;
  expect(en.language).toBe("en");
  expect(en.queues.unverifiedSource.count).toBe(0);
  expect(en.queues.untranslated.count).toBe(1);

  const fr = await queues(token, "?language=fr");
  expect(fr.status).toBe(422);
  expect((await fr.json()).error).toBe("unknown-language");

  const chrome = (await (
    await queues(token, "?type=chrome&language=pt-PT")
  ).json()) as QueuesResponse;
  expect(chrome.type).toBe("chrome");
  expect(chrome.queues.unverifiedSource.items).toEqual([
    { key: CONTINUE, language: "pt-PT", type: "chrome" },
  ]);
  const none = (await (
    await queues(token, "?type=nope")
  ).json()) as QueuesResponse;
  expect(none.queues.untranslated.count).toBe(0);
});
