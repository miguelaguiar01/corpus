import { moonlightManor, type Snapshot } from "@corpus/contract";
import { expect, test } from "vitest";
import { queueCounts } from "@/catalogue/queues";
import { projects, users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "@/ingest/apply";
import { stringDetail } from "@/strings/detail";
import { verifyFlow } from "./verify-flow";

const FIXTURE = moonlightManor as Snapshot;
const KEYS = FIXTURE.strings.map((s) => s.id);

function pushed() {
  const db = memoryDb();
  const [p] = db
    .insert(projects)
    .values({
      slug: "mm",
      name: "MM",
      sourceLanguage: "pt-PT",
      languages: ["pt-PT", "en"],
    })
    .returning()
    .all();
  const [ana] = db
    .insert(users)
    .values({ name: "ana", maintainer: true })
    .returning()
    .all();
  const [rui] = db
    .insert(users)
    .values({ name: "rui", maintainer: false })
    .returning()
    .all();
  if (!p || !ana || !rui) throw new Error("seed failed");
  applySnapshot(db, p.id, FIXTURE);
  return { db, p, ana, rui };
}

function versionOfSource(
  db: ReturnType<typeof memoryDb>,
  projectId: number,
  key: string,
) {
  return stringDetail(db, projectId, key)!.translations["pt-PT"]!.version;
}

test("a maintainer verifying from the queue moves on to the next item", () => {
  const { db, p, ana } = pushed();
  const result = verifyFlow(db, {
    project: p,
    user: ana,
    key: KEYS[0]!,
    queue: "unverifiedSource",
    openedVersion: versionOfSource(db, p.id, KEYS[0]!),
  });
  expect(result).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[1]!)}?queue=unverifiedSource&language=pt-PT`,
  });
  expect(stringDetail(db, p.id, KEYS[0]!)?.translations["pt-PT"]?.state).toBe(
    "verified",
  );
  expect(queueCounts(db, p.id).unverifiedSource).toBe(2);
});

test("verifying the last item in the queue returns to the dashboard", () => {
  const { db, p, ana } = pushed();
  const result = verifyFlow(db, {
    project: p,
    user: ana,
    key: KEYS[2]!,
    queue: "unverifiedSource",
  });
  expect(result).toEqual({ kind: "redirect", to: "/p/mm" });
});

test("without a queue, verifying stays on the string", () => {
  const { db, p, ana } = pushed();
  const result = verifyFlow(db, { project: p, user: ana, key: KEYS[1]! });
  expect(result).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[1]!)}`,
  });
});

test("a non-maintainer is rejected server-side and sent back with the error", () => {
  const { db, p, rui } = pushed();
  const result = verifyFlow(db, {
    project: p,
    user: rui,
    key: KEYS[0]!,
    queue: "unverifiedSource",
  });
  expect(result).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[0]!)}?queue=unverifiedSource&language=pt-PT&error=not-maintainer`,
  });
  expect(stringDetail(db, p.id, KEYS[0]!)?.translations["pt-PT"]?.state).toBe(
    "translated",
  );
});

test("a stale version token still applies but stays on the string with a warning", () => {
  const { db, p, ana } = pushed();
  const stale = versionOfSource(db, p.id, KEYS[0]!) - 60_000;
  const result = verifyFlow(db, {
    project: p,
    user: ana,
    key: KEYS[0]!,
    queue: "unverifiedSource",
    openedVersion: stale,
  });
  expect(result).toEqual({
    kind: "redirect",
    to: `/p/mm/s/${encodeURIComponent(KEYS[0]!)}?queue=unverifiedSource&language=pt-PT&warning=changed`,
  });
  expect(stringDetail(db, p.id, KEYS[0]!)?.translations["pt-PT"]?.state).toBe(
    "verified",
  );
});

test("an unknown key is not found", () => {
  const { db, p, ana } = pushed();
  expect(verifyFlow(db, { project: p, user: ana, key: "nope" })).toEqual({
    kind: "not-found",
  });
});
