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

function status(token: string | undefined) {
  return GET(
    new Request("http://corpus.test/api/status", {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );
}

test("the project's numbers with its languages, string count and last push", async () => {
  const created = provisionProject(db, {
    slug: "mm",
    name: "MM",
    sourceLanguage: "pt-PT",
    languages: ["pt-PT", "en"],
  });
  if (!created.ok) throw new Error(created.reason);

  const empty = await status(created.token);
  expect(empty.status).toBe(200);
  const before = (await empty.json()) as { strings: number; lastPushAt: null };
  expect(before.strings).toBe(0);
  expect(before.lastPushAt).toBeNull();

  applySnapshot(db, created.project.id, moonlightManor as Snapshot);
  const res = await status(created.token);
  const json = (await res.json()) as {
    project: string;
    sourceLanguage: string;
    languages: string[];
    strings: number;
    lastPushAt: string;
    version: string;
    progress: {
      perLanguage: Record<string, { total: number; untranslated: number }>;
    };
  };
  expect(json.project).toBe("mm");
  expect(json.languages).toEqual(["pt-PT", "en"]);
  expect(json.strings).toBe(moonlightManor.strings.length);
  expect(json.lastPushAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(json.version).toBe("dev");
  expect(json.progress.perLanguage.en?.total).toBe(
    moonlightManor.strings.length,
  );
  expect(json.progress.perLanguage.en?.untranslated).toBe(
    moonlightManor.strings.length,
  );

  // A string dropped from the next push is archived: out of the count,
  // as out of the dashboard; the last push moves.
  const fewer = structuredClone(moonlightManor) as Snapshot;
  fewer.strings.pop();
  applySnapshot(db, created.project.id, fewer);
  const after = (await (await status(created.token)).json()) as {
    strings: number;
    lastPushAt: string;
  };
  expect(after.strings).toBe(moonlightManor.strings.length - 1);
  expect(after.lastPushAt >= json.lastPushAt).toBe(true);
});

test("no token is 401", async () => {
  expect((await status(undefined)).status).toBe(401);
});
