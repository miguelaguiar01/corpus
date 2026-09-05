import { expect, test } from "vitest";
import { users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { createProject, findProjectByToken, getProjectBySlug } from "./service";
import { rotateToken, setMaintainer, updateLanguages } from "./settings";

function seed() {
  const db = memoryDb();
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
  const created = createProject(
    db,
    {
      slug: "mm",
      name: "MM",
      sourceLanguage: "pt-PT",
      languages: ["pt-PT", "en"],
    },
    ana!,
  );
  if (!created.ok) throw new Error(created.reason);
  return {
    db,
    ana: ana!,
    rui: rui!,
    project: created.project,
    token: created.token,
  };
}

test("rotateToken invalidates the old token and returns the new one once", () => {
  const { db, ana, project, token } = seed();
  const result = rotateToken(db, project.id, ana);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.token).not.toBe(token);
  expect(findProjectByToken(db, token)).toBeUndefined();
  expect(findProjectByToken(db, result.token)?.id).toBe(project.id);
});

test("rotateToken is maintainer-only", () => {
  const { db, rui, project, token } = seed();
  expect(rotateToken(db, project.id, rui)).toEqual({
    ok: false,
    reason: "forbidden",
  });
  expect(findProjectByToken(db, token)?.id).toBe(project.id);
});

test("updateLanguages keeps the source language and dedupes", () => {
  const { db, ana, project } = seed();
  expect(updateLanguages(db, project.id, ["en", "fr", "fr"], ana)).toEqual({
    ok: true,
  });
  expect(getProjectBySlug(db, "mm")?.languages).toEqual(["pt-PT", "en", "fr"]);
  expect(updateLanguages(db, project.id, [], ana)).toEqual({ ok: true });
  expect(getProjectBySlug(db, "mm")?.languages).toEqual(["pt-PT"]);
});

test("updateLanguages rejects blanks and non-maintainers", () => {
  const { db, ana, rui, project } = seed();
  expect(updateLanguages(db, project.id, ["  "], ana)).toEqual({
    ok: false,
    reason: "invalid",
  });
  expect(updateLanguages(db, project.id, ["en"], rui)).toEqual({
    ok: false,
    reason: "forbidden",
  });
});

test("setMaintainer toggles the flag; the actor's own flag is read fresh", () => {
  const { db, ana, rui } = seed();
  expect(setMaintainer(db, rui.id, true, ana)).toEqual({ ok: true });
  expect(
    db
      .select()
      .from(users)
      .all()
      .find((u) => u.id === rui.id)?.maintainer,
  ).toBe(true);
  // rui is now a maintainer in the database, whatever the stale object says.
  expect(setMaintainer(db, ana.id, false, rui)).toEqual({ ok: true });
  // ana no longer is, whatever her stale object says.
  expect(setMaintainer(db, rui.id, false, ana)).toEqual({
    ok: false,
    reason: "forbidden",
  });
});

test("the last maintainer cannot be demoted", () => {
  const { db, ana } = seed();
  expect(setMaintainer(db, ana.id, false, ana)).toEqual({
    ok: false,
    reason: "last-maintainer",
  });
  expect(
    db
      .select()
      .from(users)
      .all()
      .find((u) => u.id === ana.id)?.maintainer,
  ).toBe(true);
});
