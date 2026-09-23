import { moonlightManor, type Snapshot } from "@corpus/contract";
import { expect, test, vi } from "vitest";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "@/ingest/apply";
import { provisionProject } from "@/projects/service";

const db = memoryDb();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => db,
}));

const { GET } = await import("./route");

function digests(token?: string) {
  return GET(
    new Request("http://localhost/api/push/digests", {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );
}

test("the last push's seed digests per language, null before one, 401 without a token (#601)", async () => {
  const created = provisionProject(db, {
    slug: "mm",
    name: "MM",
    sourceLanguage: "pt-PT",
    languages: ["pt-PT", "en"],
  });
  if (!created.ok) throw new Error(created.reason);
  expect((await digests()).status).toBe(401);
  const before = await digests(created.token);
  expect(before.status).toBe(200);
  expect(await before.json()).toEqual({ seedDigests: null });
  applySnapshot(db, created.project.id, {
    ...(moonlightManor as Snapshot),
    seedDigests: { en: "0123456789abcdef" },
  });
  expect(await (await digests(created.token)).json()).toEqual({
    seedDigests: { en: "0123456789abcdef" },
  });
});
