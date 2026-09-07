import { expect, test, vi } from "vitest";
import { memoryDb } from "@/db/test-helpers";
import { findProjectByToken } from "@/projects/service";

const db = memoryDb();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => db,
}));

const SECRET = "instance-secret";
process.env.CORPUS_INVITE_SECRET = SECRET;

const { POST } = await import("./route");

let seq = 0;
function create(body: unknown, secret: string | null = SECRET) {
  seq += 1;
  return POST(
    new Request("http://corpus.test/api/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.0.0.${seq}`,
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const input = {
  slug: "moonlight-manor",
  name: "Moonlight Manor",
  sourceLanguage: "pt-PT",
  languages: ["pt-PT", "en"],
};

test("the secret creates the project and returns its token once", async () => {
  const res = await create(input);
  expect(res.status).toBe(201);
  const json = (await res.json()) as { slug: string; token: string };
  expect(json.slug).toBe("moonlight-manor");
  expect(findProjectByToken(db, json.token)?.slug).toBe("moonlight-manor");
});

test("a taken slug is 409", async () => {
  const res = await create(input);
  expect(res.status).toBe(409);
});

test("invalid input is 422, both shape and content", async () => {
  expect((await create({ slug: "x" })).status).toBe(422);
  expect(
    (await create({ ...input, slug: "Bad Slug", languages: ["en"] })).status,
  ).toBe(422);
});

test("bad JSON is 400", async () => {
  expect((await create("{")).status).toBe(400);
});

test("no secret or a wrong one is 401 and creates nothing", async () => {
  const body = { ...input, slug: "never" };
  expect((await create(body, null)).status).toBe(401);
  expect((await create(body, "wrong")).status).toBe(401);
  expect((await create(body)).status).toBe(201);
});
