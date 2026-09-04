import { moonlightManor } from "@corpus/contract";
import { expect, test, vi } from "vitest";
import { users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { createProject } from "@/projects/service";

const db = memoryDb();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => db,
}));

const { POST } = await import("./route");

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
      slug: `moonlight-manor-${seq}`,
      name: "Moonlight Manor",
      sourceLanguage: "pt-PT",
      languages: ["pt-PT", "en"],
    },
    actor,
  );
  if (!created.ok) throw new Error(created.reason);
  return { token: created.token, slug: created.project.slug };
}

function push(token: string | undefined, body: unknown) {
  return POST(
    new Request("http://corpus.test/api/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

function forProject(slug: string) {
  const snap = structuredClone(moonlightManor);
  snap.project = slug;
  return snap;
}

test("a valid push applies and returns the diff report", async () => {
  const { token, slug } = setup();
  const res = await push(token, forProject(slug));
  expect(res.status).toBe(200);
  const json = (await res.json()) as { report: { added: number } };
  expect(json.report.added).toBe(moonlightManor.strings.length);
});

test("no token → 401", async () => {
  const { slug } = setup();
  const res = await push(undefined, forProject(slug));
  expect(res.status).toBe(401);
});

test("an invalid snapshot → 422 with per-entry errors and nothing applied", async () => {
  const { token, slug } = setup();
  const bad = forProject(slug);
  bad.strings[0]!.source = "{n, plural, one {x} other {y}}";
  const res = await push(token, bad);
  expect(res.status).toBe(422);
  const json = (await res.json()) as { errors: { id: string }[] };
  expect(json.errors.length).toBeGreaterThan(0);
});

test("a token for a different project → 403", async () => {
  const { token } = setup();
  const res = await push(token, forProject("some-other-project"));
  expect(res.status).toBe(403);
});
