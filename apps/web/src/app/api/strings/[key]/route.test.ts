import type { StringResponse } from "@corpus/contract";
import { expect, test, vi } from "vitest";
import { agentDraft } from "@/agents/draft";
import { ensureAgentActor } from "@/agents/actor";
import {
  CONTINUE,
  FIXTURE,
  GREENHOUSE,
  pushedProject,
  stringRowId,
} from "@/agents/test-helpers";
import { applySnapshot } from "@/ingest/apply";
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
  expect(body.keyIsText).toBe(false);
  expect(body.richText).toBeNull();
  expect(body.translations.en).toMatchObject({ invalid: false, problem: null });
  expect(body.placeholders).toEqual(["person", "room_de", "hour"]);
  expect(body.slots).toEqual([
    {
      name: "person",
      description: "Full name with article",
      role: "np-def",
      format: null,
      written: null,
      values: { "pt-PT": "a Condessa Rosa", en: "Countess Rosa" },
      fromSource: [],
      missing: [],
    },
    {
      name: "room_de",
      description: "Room with 'de' contraction baked in",
      role: "de-contraction",
      format: null,
      written: null,
      values: { "pt-PT": "da estufa", en: "greenhouse" },
      fromSource: [],
      missing: [],
    },
    {
      name: "hour",
      description: "Time of the sighting, e.g. 21h",
      role: null,
      format: null,
      written: null,
      values: { "pt-PT": "21h", en: "9 pm" },
      fromSource: [],
      missing: ["role"],
    },
  ]);
  expect(body.selects).toEqual(["person_gender"]);
  expect(body.forms).toBe(0);
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

test("a seeded translation that fails validation carries the flag and what is wrong (#646)", async () => {
  const { db, project, token } = seeded;
  applySnapshot(db, project.id, {
    ...FIXTURE,
    seedTranslations: { en: { [CONTINUE]: "Continue {x}" } },
  });
  const res = await string(token, CONTINUE);
  const body = (await res.json()) as StringResponse;
  expect(body.translations.en).toMatchObject({
    text: "Continue {x}",
    invalid: true,
    problem: "Unexpected {x}",
  });
  applySnapshot(db, project.id, FIXTURE);
});

test("a string's key arguments are in its response, and absent where it has none (#737)", async () => {
  const { db, project, token } = seeded;
  const favorite = "notifications.label.favorite %lld";
  applySnapshot(db, project.id, {
    ...FIXTURE,
    strings: [
      ...FIXTURE.strings,
      {
        id: favorite,
        type: FIXTURE.strings[0]!.type,
        source: "starred",
        library: "printf",
        syntax: "printf",
        arguments: ["%lld"],
      },
    ],
  });
  const withArguments = (await (
    await string(token, favorite)
  ).json()) as StringResponse;
  expect(withArguments.arguments).toEqual(["%lld"]);
  const without = (await (await string(token, CONTINUE)).json()) as Record<
    string,
    unknown
  >;
  expect("arguments" in without).toBe(false);
  // An empty list, as an exporter may send, is none.
  applySnapshot(db, project.id, {
    ...FIXTURE,
    strings: FIXTURE.strings.map((s) =>
      s.id === CONTINUE ? { ...s, arguments: [] } : s,
    ),
  });
  const empty = (await (await string(token, CONTINUE)).json()) as Record<
    string,
    unknown
  >;
  expect("arguments" in empty).toBe(false);
  applySnapshot(db, project.id, FIXTURE);
});

test("get_string carries a language's suggestion, the row's state unchanged; a language without one has none (#773)", async () => {
  const { db, project, token } = seeded;
  const read = async () =>
    (await (await string(token, CONTINUE)).json()) as StringResponse;
  const before = (await read()).translations.en!;
  applySnapshot(db, project.id, {
    ...FIXTURE,
    seedSuggestions: { en: { [CONTINUE]: "Carry on?" } },
  });
  const body = await read();
  expect(body.translations.en).toMatchObject({
    suggestion: "Carry on?",
    state: before.state,
    text: before.text,
  });
  for (const [language, row] of Object.entries(body.translations))
    if (language !== "en") expect("suggestion" in row).toBe(false);
  applySnapshot(db, project.id, FIXTURE);
  expect("suggestion" in (await read()).translations.en!).toBe(false);
});

test("a vue string under vue-i18n's default rule says what each form is shown for, and an agent's draft of another count saves with the warning (#1018)", async () => {
  const { db, project, token } = seeded;
  const minutes = "vue.minutes";
  applySnapshot(db, project.id, {
    ...FIXTURE,
    strings: [
      ...FIXTURE.strings,
      {
        id: minutes,
        type: FIXTURE.strings[0]!.type,
        source: "{n} minute | {n} minutes",
        library: "vue",
        syntax: "vue",
        pluralRules: "default",
      },
    ],
  });
  const body = (await (await string(token, minutes)).json()) as StringResponse;
  expect(body.forms).toBe(2);
  expect(body.formMeanings).toEqual(["=1", "other"]);
  const plain = (await (await string(token, CONTINUE)).json()) as Record<
    string,
    unknown
  >;
  expect("formMeanings" in plain).toBe(false);
  // A CLDR-minded Polish draft of three forms, which the rule reads
  // shifted, saves and says so.
  const draft = agentDraft(db, {
    project,
    key: minutes,
    language: "en",
    text: "{n} minuta | {n} minuty | {n} minut",
  });
  expect(draft).toMatchObject({
    ok: true,
    incomplete: [expect.stringContaining("3 forms read as =0 | =1 | other")],
  });
  applySnapshot(db, project.id, FIXTURE);
});

test("under a type read as HTML, the string lists the placeholders its tags' attributes hold; elsewhere a tag carries them whole, but one read as prose (#1030)", async () => {
  const { db, project, token } = seeded;
  const source =
    "<a href='%{userUrl}'>%{user}</a> posted <a href='%{topicUrl}'>a topic</a>";
  applySnapshot(db, project.id, {
    ...FIXTURE,
    richText: { ...(FIXTURE.richText ?? {}), html: "html" },
    strings: [
      ...FIXTURE.strings,
      {
        id: "user_posted_topic",
        type: "html",
        source,
        library: "rails",
        syntax: "rails",
      },
      {
        id: "user_posted_topic_plain",
        type: "plain",
        source,
        library: "rails",
        syntax: "rails",
      },
    ],
  });
  const html = (await (
    await string(token, "user_posted_topic")
  ).json()) as StringResponse;
  expect(html.placeholders).toEqual(["user"]);
  expect(html.attributePlaceholders).toEqual(["userUrl", "topicUrl"]);
  const plain = (await (
    await string(token, "user_posted_topic_plain")
  ).json()) as Record<string, unknown>;
  expect("attributePlaceholders" in plain).toBe(false);
  // Outside HTML a tag read as prose, which `tags` does not carry, still
  // has its attribute's placeholder required: it is listed.
  applySnapshot(db, project.id, {
    ...FIXTURE,
    strings: [
      ...FIXTURE.strings,
      {
        id: "prose_title",
        type: "plain",
        source: '<p title="{{x}}">Hello {{name}}',
        library: "i18next",
        syntax: "i18next",
      },
    ],
  });
  const prose = (await (
    await string(token, "prose_title")
  ).json()) as StringResponse;
  expect([prose.placeholders, prose.tags, prose.attributePlaceholders]).toEqual(
    [["name"], [], ["x"]],
  );
  applySnapshot(db, project.id, FIXTURE);
});

test("a slot a target language has no example value for takes the source's, listed in fromSource (#1075)", async () => {
  const { db, project, token } = seeded;
  applySnapshot(db, project.id, {
    ...FIXTURE,
    strings: [
      ...FIXTURE.strings,
      {
        id: "ui.greet",
        type: "chrome",
        file: "src/ui/pt-PT.json",
        source: "Olá {who}",
        examples: [{ values: { who: "Ana" }, rendered: "Olá Ana" }],
      },
    ],
  });
  const body = (await (
    await string(token, "ui.greet")
  ).json()) as StringResponse;
  expect(body.slots).toMatchObject([
    {
      name: "who",
      values: { "pt-PT": "Ana", en: "Ana" },
      fromSource: ["en"],
      missing: ["description", "role"],
    },
  ]);
});
