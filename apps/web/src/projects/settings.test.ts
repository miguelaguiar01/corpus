import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { createSession, getSessionUser, signIn } from "@/auth/service";
import { hashPassword } from "@/auth/password";
import { createProject, findProjectByToken, getProjectBySlug } from "./service";
import {
  resetUserPassword,
  rotateToken,
  setMaintainer,
  updateLanguages,
} from "./settings";

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

test("demotion ends the person's sessions; promotion leaves them alone", () => {
  const { db, ana, rui } = seed();
  const ruiSession = createSession(db, rui.id);
  const anaSession = createSession(db, ana.id);
  expect(setMaintainer(db, rui.id, true, ana)).toEqual({ ok: true });
  expect(getSessionUser(db, ruiSession)?.name).toBe("rui");
  expect(setMaintainer(db, rui.id, false, ana)).toEqual({ ok: true });
  expect(getSessionUser(db, ruiSession)).toBeUndefined();
  expect(getSessionUser(db, anaSession)?.name).toBe("ana");
});

test("resetUserPassword is maintainer-only and needs a real user", () => {
  const { db, ana, rui } = seed();
  expect(resetUserPassword(db, ana.id, rui)).toEqual({
    ok: false,
    reason: "forbidden",
  });
  expect(resetUserPassword(db, 999, ana)).toEqual({
    ok: false,
    reason: "not-found",
  });
});

test("resetUserPassword ends sessions and hands out a temporary password once", () => {
  const { db, ana, rui } = seed();
  db.update(users)
    .set({ passwordHash: hashPassword("rui's password") })
    .where(eq(users.id, rui.id))
    .run();
  const session = createSession(db, rui.id);
  const result = resetUserPassword(db, rui.id, ana);
  if (!result.ok) throw new Error(result.reason);
  expect(result.temporary).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
  expect(getSessionUser(db, session)).toBeUndefined();
  expect(signIn(db, { name: "rui", password: "rui's password" }).ok).toBe(
    false,
  );
  const next = signIn(db, { name: "rui", password: result.temporary });
  expect(next.ok && next.mustChangePassword).toBe(true);
});
