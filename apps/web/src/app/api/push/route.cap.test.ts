import { gzipSync } from "node:zlib";
import { moonlightManor } from "@corpus/contract";
import { expect, test, vi } from "vitest";
import { users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { createProject } from "@/projects/service";

// The cap on a body as read, under a cap small enough that a body past
// it is cheap to build (#717); limits.test.ts pins the real one.
const CAP = 64 * 1024;
vi.mock("@/api/limits", async (importActual) => ({
  ...(await importActual<typeof import("@/api/limits")>()),
  MAX_BODY_BYTES: CAP,
}));

const db = memoryDb();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => db,
}));

const { POST } = await import("./route");

const [actor] = db
  .insert(users)
  .values({ name: "boss", maintainer: true })
  .returning()
  .all();
const created = createProject(
  db,
  {
    slug: "moonlight-manor",
    name: "Moonlight Manor",
    sourceLanguage: "pt-PT",
    languages: ["pt-PT", "en"],
  },
  actor!,
);
if (!created.ok) throw new Error(created.reason);
const { token } = created;

function snapshot(source?: string) {
  const snap = structuredClone(moonlightManor);
  snap.project = "moonlight-manor";
  if (source !== undefined) snap.strings[0]!.source = source;
  return snap;
}

function push(body: unknown, gzip = false) {
  const text = JSON.stringify(body);
  return POST(
    new Request("http://corpus.test/api/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(gzip && { "content-encoding": "gzip" }),
        authorization: `Bearer ${token}`,
      },
      body: gzip ? new Uint8Array(gzipSync(text)) : text,
    }),
  );
}

test("a body under the cap applies, as read and as gzipped", async () => {
  expect(JSON.stringify(snapshot()).length).toBeLessThan(CAP);
  expect((await push(snapshot())).status).toBe(200);
  expect((await push(snapshot(), true)).status).toBe(200);
});

test("a body over the cap → 413 before it is parsed, the cap counted in bytes", async () => {
  expect((await push(snapshot("x".repeat(CAP + 1)))).status).toBe(413);
  // Under the cap in characters, over it in UTF-8 bytes.
  expect((await push(snapshot("é".repeat(CAP / 2 + 1)))).status).toBe(413);
});

test("the cap holds on a gzipped body's inflated size", async () => {
  const big = snapshot("x".repeat(CAP + 1));
  expect(gzipSync(JSON.stringify(big)).length).toBeLessThan(CAP);
  expect((await push(big, true)).status).toBe(413);
});
