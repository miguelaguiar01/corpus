import { moonlightManor, type Snapshot } from "@corpus/contract";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { strings, users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "@/ingest/apply";
import { provisionProject } from "@/projects/service";
import { applyTransition } from "@/translations/service";

export const FIXTURE = moonlightManor as Snapshot;
export const GREENHOUSE = "skin.seen-at-greenhouse-window";
export const HEARD = "skin.heard-nothing";
export const CONTINUE = "ui.continue";

// A pushed project with a token, a maintainer and a translator, as the
// route tests need it: every target row untranslated, nothing edited.
export function pushedProject() {
  const db = memoryDb();
  const created = provisionProject(db, {
    slug: "mm",
    name: "MM",
    sourceLanguage: "pt-PT",
    languages: ["pt-PT", "en"],
  });
  if (!created.ok) throw new Error(created.reason);
  const [ana, rui] = db
    .insert(users)
    .values([
      { name: "ana", maintainer: true },
      { name: "rui", maintainer: false },
    ])
    .returning()
    .all();
  if (!ana || !rui) throw new Error("seed failed");
  applySnapshot(db, created.project.id, FIXTURE);
  return { db, project: created.project, token: created.token, ana, rui };
}

export function stringRowId(db: Db, key: string): number {
  const row = db.select().from(strings).where(eq(strings.stringId, key)).get();
  if (!row) throw new Error(`no string ${key}`);
  return row.id;
}

// A person's save on a row, so the draft rule has something to refuse.
export function personSaves(
  db: Db,
  actor: { id: number; maintainer: boolean },
  key: string,
  language: string,
  text: string,
): void {
  const result = applyTransition(db, {
    stringId: stringRowId(db, key),
    language,
    action: { type: "save", text },
    actor,
  });
  if ("error" in result) throw new Error(result.error);
}

export function personVerifies(
  db: Db,
  actor: { id: number; maintainer: boolean },
  key: string,
  language: string,
): void {
  const result = applyTransition(db, {
    stringId: stringRowId(db, key),
    language,
    action: { type: "verify" },
    actor,
  });
  if ("error" in result) throw new Error(result.error);
}
