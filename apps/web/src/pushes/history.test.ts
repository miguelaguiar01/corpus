import { moonlightManor, type Snapshot } from "@corpus/contract";
import { expect, test } from "vitest";
import { projects } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "@/ingest/apply";
import { pushHistory } from "./history";

const FIXTURE = moonlightManor as Snapshot;

test("history lists a project's pushes newest first with their counts", () => {
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
  const [other] = db
    .insert(projects)
    .values({ slug: "o", name: "O", sourceLanguage: "en", languages: ["en"] })
    .returning()
    .all();
  applySnapshot(db, p!.id, FIXTURE);
  applySnapshot(db, other!.id, {
    ...FIXTURE,
    project: "o",
    sourceLanguage: "en",
  });
  applySnapshot(db, p!.id, {
    ...FIXTURE,
    strings: FIXTURE.strings.slice(0, 2),
  });
  const history = pushHistory(db, p!.id);
  expect(history.map((h) => [h.stringCount, h.added, h.archived])).toEqual([
    [2, 0, 1],
    [3, 3, 0],
  ]);
});
