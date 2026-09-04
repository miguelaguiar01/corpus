import { moonlightManor, type Snapshot } from "@corpus/contract";
import { expect, test, vi } from "vitest";
import { users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "@/ingest/apply";
import { createProject } from "@/projects/service";

const db = memoryDb();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => db,
}));

const { GET } = await import("./route");

let seq = 0;
function setup() {
  seq += 1;
  const [actor] = db
    .insert(users)
    .values({ name: `boss-${seq}`, maintainer: true })
    .returning()
    .all();
  if (!actor) throw new Error("seed failed");
  const created = createProject(
    db,
    {
      slug: `mm-${seq}`,
      name: "MM",
      sourceLanguage: "pt-PT",
      languages: ["pt-PT", "en"],
    },
    actor,
  );
  if (!created.ok) throw new Error(created.reason);
  applySnapshot(db, created.project.id, moonlightManor as Snapshot);
  return { token: created.token, slug: created.project.slug };
}

function pull(token: string | undefined, query = "") {
  return GET(
    new Request(`http://corpus.test/api/pull${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );
}

test("without a token it is unauthorized", async () => {
  setup();
  expect((await pull(undefined)).status).toBe(401);
});

test("defaults to verified and returns the contract payload", async () => {
  const { token, slug } = setup();
  const res = await pull(token);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    minState: string;
    project: string;
    translations: Record<string, Record<string, string>>;
  };
  expect(body.project).toBe(slug);
  expect(body.minState).toBe("verified");
  expect(body.translations["pt-PT"]).toEqual({});
});

test("minState loosens the filter", async () => {
  const { token } = setup();
  const res = await pull(token, "?minState=untranslated");
  const body = (await res.json()) as {
    translations: Record<string, Record<string, string>>;
  };
  expect(Object.keys(body.translations["pt-PT"]!)).toHaveLength(3);
});

test("an unknown minState is a 400", async () => {
  const { token } = setup();
  expect((await pull(token, "?minState=done")).status).toBe(400);
});
