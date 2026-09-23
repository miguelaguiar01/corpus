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

test("what the editor shows: the string, every language, the proposal, the note, the glossary, the entities, the siblings", async () => {
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
  expect(body.slots).toEqual([
    {
      name: "person",
      description: "Full name with article",
      role: "np-def",
      format: null,
      written: null,
      values: { "pt-PT": "a Condessa Rosa", en: "Countess Rosa" },
    },
    {
      name: "room_de",
      description: "Room with 'de' contraction baked in",
      role: "de-contraction",
      format: null,
      written: null,
      values: { "pt-PT": "da estufa", en: "greenhouse" },
    },
    {
      name: "hour",
      description: "Time of the sighting, e.g. 21h",
      role: null,
      format: null,
      written: null,
      values: { "pt-PT": "21h", en: "9 pm" },
    },
  ]);
  expect(body.selects).toEqual(["person_gender"]);
  expect(body.tags).toEqual([]);
  // `library` is the name; `syntax` rides beside it until 1.0 (#522).
  expect(body.library).toBe("icu");
  expect(body.syntax).toBe("icu");
  expect(body.examples.length).toBeGreaterThan(0);
  expect(body.metadata).toMatchObject({ kind: "sighting" });
  expect(body.note).toMatch(/household staff/);
  expect(body.glossary).toEqual({
    en: [{ term: "janela", target: "window", note: "never 'casement'" }],
  });
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
  expect(body.entities).toEqual([
    {
      field: "requires_trait",
      entityId: "trait:insomnia",
      type: "trait",
      typeLabel: "Trait",
      name: "Insónia",
      attributes: { summary: "This character wanders the manor at night." },
    },
    {
      field: "mentions",
      entityId: "character:condessa-rosa",
      type: "character",
      typeLabel: "Character",
      name: "Condessa Rosa",
      attributes: { title: "Condessa", suspicious: "very" },
    },
    {
      field: "mentions",
      entityId: "character:doutor-vaz",
      type: "character",
      typeLabel: "Character",
      name: "Doutor Vaz",
      attributes: null,
    },
  ]);
  const plain = (await (
    await string(token, CONTINUE)
  ).json()) as StringResponse;
  expect(plain.entities).toEqual([]);
  expect(body.siblingCount).toBe(1);
  expect(body.siblings).toEqual([
    {
      key: "skin.heard-nothing",
      source: "Não ouvi nada a noite toda.",
      translations: {
        en: { state: "untranslated", stale: false, text: null },
      },
    },
  ]);
});
