import type { StringResponse } from "@corpus/contract";
import { expect, test, vi } from "vitest";
import { agentDraft } from "@/agents/draft";
import { ensureAgentActor } from "@/agents/actor";
import {
  CONTINUE,
  GREENHOUSE,
  pushedProject,
  stringRowId,
} from "@/agents/test-helpers";
import { proposeEdit } from "@/proposals/service";

const seeded = pushedProject();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => seeded.db,
}));

const { GET } = await import("./route");

function string(token: string | undefined, key: string) {
  return GET(
    new Request(`http://corpus.test/api/strings/${encodeURIComponent(key)}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    { params: Promise.resolve({ key }) },
  );
}

test("a string needs the token and must exist", async () => {
  expect((await string(undefined, CONTINUE)).status).toBe(401);
  expect((await string(seeded.token, "no.such")).status).toBe(404);
});

test("what the editor shows: source, placeholders, selects, examples, every language, the pending proposal", async () => {
  const { db, project, token } = seeded;
  agentDraft(db, {
    project,
    key: GREENHOUSE,
    language: "en",
    text: "{person} was {person_gender, select, m {seen} f {seen}} at the {room_de} window at {hour}.",
  });
  proposeEdit(db, {
    stringRowId: stringRowId(db, GREENHOUSE),
    text: "Alguém foi visto à janela.",
    actor: ensureAgentActor(db, project),
  });

  const res = await string(token, GREENHOUSE);
  expect(res.status).toBe(200);
  const body = (await res.json()) as StringResponse;
  expect(body.key).toBe(GREENHOUSE);
  expect(body.type).toBe("clue-skin");
  expect(body.sourceLanguage).toBe("pt-PT");
  expect(body.file).toBe("src/skins/pt-PT.json");
  expect(body.placeholders).toEqual(["person", "room_de", "hour"]);
  expect(body.selects).toEqual(["person_gender"]);
  expect(body.examples.length).toBeGreaterThan(0);
  expect(body.metadata).toMatchObject({ kind: "sighting" });
  expect(body.translations["pt-PT"]).toMatchObject({
    state: "translated",
    agentDraft: false,
  });
  expect(body.translations.en).toMatchObject({
    state: "translated",
    stale: false,
    agentDraft: true,
  });
  expect(body.proposal).toMatchObject({
    kind: "edit",
    text: "Alguém foi visto à janela.",
    author: "mm agent",
  });
  expect(body.siblingCount).toBe(1);
  expect(body.siblings).toEqual([
    {
      key: "skin.heard-nothing",
      source: "Não ouvi nada a noite toda.",
      translations: {
        "pt-PT": {
          state: "translated",
          stale: false,
          text: null,
        },
        en: { state: "untranslated", stale: false, text: null },
      },
    },
  ]);
});
