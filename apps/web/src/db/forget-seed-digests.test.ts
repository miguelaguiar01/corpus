// #1009's data migration: a seed is now the source's text by meaning, so
// the next push resends every seed and a restructured copy an earlier
// push stored as translated is read again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { moonlightManor, type Snapshot } from "@corpus/contract";
import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { applySnapshot } from "@/ingest/apply";
import { projects, stringTranslations } from "./schema";
import { MIGRATIONS_DIR, memoryDb } from "./test-helpers";

const forget = readFileSync(
  path.join(MIGRATIONS_DIR, "0026_forget-seed-digests-same-message.sql"),
  "utf8",
);

test("the seed digests are forgotten, so the next push reads a restructured copy as the source's text", () => {
  const db = memoryDb();
  const [project] = db
    .insert(projects)
    .values({
      slug: "mm",
      name: "MM",
      sourceLanguage: "pt-PT",
      languages: ["pt-PT", "en"],
      seedDigests: { en: "stale" },
    })
    .returning()
    .all();
  const copy =
    "{n,plural,=0 {Nenhuma marca por encontrar.} one {Falta {n, number} marca.} other {Faltam {n,number} marcas.}}";
  const fixture = {
    ...(moonlightManor as Snapshot),
    seedTranslations: { en: { "ui.marks-left": copy } },
  };
  applySnapshot(db, project!.id, fixture);
  // What a push before #1009 stored for it.
  db.update(stringTranslations)
    .set({ state: "translated" })
    .where(eq(stringTranslations.language, "en"))
    .run();
  db.run(sql.raw(forget));
  expect(
    db.select().from(projects).where(eq(projects.id, project!.id)).get()
      ?.seedDigests,
  ).toBeNull();
  applySnapshot(db, project!.id, fixture);
  const row = db
    .select({ state: stringTranslations.state, text: stringTranslations.text })
    .from(stringTranslations)
    .where(eq(stringTranslations.language, "en"))
    .all()
    .find((r) => r.text === copy);
  expect(row?.state).toBe("untranslated");
});
