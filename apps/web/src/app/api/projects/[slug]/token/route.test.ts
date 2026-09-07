import { expect, test, vi } from "vitest";
import { memoryDb } from "@/db/test-helpers";
import { findProjectByToken, provisionProject } from "@/projects/service";

const db = memoryDb();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => db,
}));

const { POST } = await import("./route");

function rotate(slug: string, token: string | undefined) {
  return POST(
    new Request(`http://corpus.test/api/projects/${slug}/token`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    { params: Promise.resolve({ slug }) },
  );
}

function project(slug: string) {
  const created = provisionProject(db, {
    slug,
    name: slug,
    sourceLanguage: "pt-PT",
    languages: ["pt-PT", "en"],
  });
  if (!created.ok) throw new Error(created.reason);
  return created.token;
}

test("the current token rotates itself; the old one stops working", async () => {
  const old = project("moonlight-manor");
  const res = await rotate("moonlight-manor", old);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { slug: string; token: string };
  expect(json.token).not.toBe(old);
  expect(findProjectByToken(db, old)).toBeUndefined();
  expect(findProjectByToken(db, json.token)?.slug).toBe("moonlight-manor");
});

test("no token is 401; another project's token is 403 and rotates nothing", async () => {
  const mine = project("mine");
  const theirs = project("theirs");
  expect((await rotate("mine", undefined)).status).toBe(401);
  expect((await rotate("theirs", mine)).status).toBe(403);
  expect(findProjectByToken(db, theirs)?.slug).toBe("theirs");
});
