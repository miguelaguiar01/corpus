import { expect, test, vi } from "vitest";
import {
  CONTINUE,
  GREENHOUSE,
  HEARD,
  personSaves,
  pushedProject,
} from "@/agents/test-helpers";
import { stringDetail } from "@/strings/detail";

const seeded = pushedProject();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => seeded.db,
}));

const { PUT } = await import("./route");

function draft(
  token: string | undefined,
  key: string,
  lang: string,
  body: unknown,
) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return PUT(
    new Request(
      `http://corpus.test/api/strings/${encodeURIComponent(key)}/translations/${lang}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: text,
      },
    ),
    { params: Promise.resolve({ key, lang }) },
  );
}

test("a draft needs the token and a body with text", async () => {
  const { token } = seeded;
  expect((await draft(undefined, CONTINUE, "en", { text: "x" })).status).toBe(
    401,
  );
  expect((await draft(token, CONTINUE, "en", "not json")).status).toBe(400);
  const missing = await draft(token, CONTINUE, "en", { txt: "x" });
  expect(missing.status).toBe(422);
  expect((await missing.json()).error).toBe("invalid");
});

test("a draft lands as translated, attributed to the agent, and is refused where a person worked", async () => {
  const { db, project, token, rui } = seeded;
  const ok = await draft(token, CONTINUE, "en", { text: "Continue" });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({
    key: CONTINUE,
    language: "en",
    state: "translated",
    text: "Continue",
    actor: "mm agent",
  });
  expect(stringDetail(db, project.id, CONTINUE)!.history[0]).toMatchObject({
    actor: "mm agent",
    agent: true,
  });

  personSaves(db, rui, HEARD, "en", "Nothing.");
  const refused = await draft(token, HEARD, "en", { text: "Nothing at all." });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    error: "human-edited",
    message: `${HEARD} in en holds a person's work; propose a change if the source is the problem; otherwise leave the row to its author`,
  });
});

test("the editor's refusals come back as the same reasons", async () => {
  const { token } = seeded;
  const cases: [string, string, string, number, string][] = [
    [CONTINUE, "pt-PT", "x", 422, "source-row"],
    [CONTINUE, "fr", "x", 422, "unknown-language"],
    [CONTINUE, "en", " ", 422, "empty-text"],
    [GREENHOUSE, "en", "Someone was seen.", 422, "invalid-translation"],
    ["no.such", "en", "x", 404, "not-found"],
  ];
  for (const [key, lang, text, status, error] of cases) {
    const res = await draft(token, key, lang, { text });
    expect([key, lang, res.status]).toEqual([key, lang, status]);
    expect((await res.json()).error).toBe(error);
  }
});

test("an oversized body, an archived string and another project's token are refused", async () => {
  const { db, token, project } = seeded;
  const big = await draft(token, CONTINUE, "en", {
    text: "x".repeat(70 * 1024),
  });
  expect(big.status).toBe(413);

  const { strings } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { stringRowId } = await import("@/agents/test-helpers");
  db.update(strings)
    .set({ archived: true })
    .where(eq(strings.id, stringRowId(db, GREENHOUSE)))
    .run();
  const archived = await draft(token, GREENHOUSE, "en", {
    text: "{person} {room_de} {hour} {person_gender, select, m {a} f {b}}",
  });
  expect(archived.status).toBe(409);
  expect((await archived.json()).error).toBe("archived");

  const { provisionProject } = await import("@/projects/service");
  const other = provisionProject(db, {
    slug: "other",
    name: "Other",
    sourceLanguage: "pt-PT",
    languages: ["pt-PT", "en"],
  });
  if (!other.ok) throw new Error(other.reason);
  const foreign = await draft(other.token, CONTINUE, "en", {
    text: "Continue",
  });
  expect(foreign.status).toBe(404);
  expect(project.slug).toBe("mm");
});

test("a body with a state is told the token cannot verify; any other unknown field is named", async () => {
  const { token } = seeded;
  const verified = await draft(token, CONTINUE, "en", {
    text: "Continue",
    state: "verified",
  });
  expect(verified.status).toBe(422);
  expect(await verified.json()).toEqual({
    error: "invalid",
    message:
      "the token cannot verify; a signed-in maintainer does, in the workbench",
  });
  const other = await draft(token, CONTINUE, "en", {
    text: "Continue",
    foo: 1,
  });
  expect(other.status).toBe(422);
  expect((await other.json()).message).toBe("unknown field foo");
});

test("a state with no text is still told the rule, whatever else the body lacks", async () => {
  const { token } = seeded;
  const alone = await draft(token, CONTINUE, "en", { state: "verified" });
  expect(alone.status).toBe(422);
  expect((await alone.json()).message).toBe(
    "the token cannot verify; a signed-in maintainer does, in the workbench",
  );
});
