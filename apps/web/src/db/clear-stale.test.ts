// #934's data migration: a row an earlier push left untranslated and
// still stale is cleared once, at upgrade; a translated stale row keeps
// its mark.
import { readFileSync } from "node:fs";
import path from "node:path";
import { moonlightManor, type Snapshot } from "@corpus/contract";
import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { applySnapshot } from "@/ingest/apply";
import { projects, stringTranslations } from "./schema";
import { MIGRATIONS_DIR, memoryDb } from "./test-helpers";

const clear = readFileSync(
  path.join(MIGRATIONS_DIR, "0024_clear-stale-on-untranslated.sql"),
  "utf8",
);

test("an untranslated row loses its stale mark; a translated one keeps it", () => {
  const db = memoryDb();
  const [project] = db
    .insert(projects)
    .values({
      slug: "mm",
      name: "MM",
      sourceLanguage: "pt-PT",
      languages: ["pt-PT", "en"],
    })
    .returning()
    .all();
  const fixture = moonlightManor as Snapshot;
  applySnapshot(db, project!.id, {
    ...fixture,
    seedTranslations: { en: { [fixture.strings[1]!.id]: "Heard nothing." } },
  });
  db.update(stringTranslations).set({ stale: true }).run();
  db.run(sql.raw(clear));
  const en = db
    .select()
    .from(stringTranslations)
    .where(eq(stringTranslations.language, "en"))
    .all();
  expect(
    en.filter((r) => r.state === "untranslated").every((r) => !r.stale),
  ).toBe(true);
  expect(en.filter((r) => r.state === "translated").every((r) => r.stale)).toBe(
    true,
  );
  expect(en.some((r) => r.state === "translated")).toBe(true);
});
