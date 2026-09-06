import { LANGUAGE_RE } from "@corpus/contract";
// Maintainer corner services (§9.5, §10). Every action re-checks the
// acting user's maintainer flag; the UI only decides what to show.
import { endSessionsOf, resetPassword } from "@/auth/service";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Db } from "@/db";
import { projects, users } from "@/db/schema";
import { hashToken } from "./service";

type Actor = { id: number };

// The flag is read fresh from the database, never trusted from the
// caller, so a stale session object cannot act as a maintainer.
function isMaintainer(db: Db, actor: Actor): boolean {
  return (
    db
      .select({ m: users.maintainer })
      .from(users)
      .where(eq(users.id, actor.id))
      .get()?.m === true
  );
}
export type SettingsResult<T = object> =
  | ({ ok: true } & T)
  | {
      ok: false;
      reason: "forbidden" | "invalid" | "last-maintainer" | "not-found";
    };

// A new push token; the old one stops working at once. Returned once.
export function rotateToken(
  db: Db,
  projectId: number,
  actor: Actor,
): SettingsResult<{ token: string }> {
  if (!isMaintainer(db, actor)) return { ok: false, reason: "forbidden" };
  const token = randomBytes(24).toString("hex");
  const updated = db
    .update(projects)
    .set({ tokenHash: hashToken(token) })
    .where(eq(projects.id, projectId))
    .returning({ id: projects.id })
    .all();
  if (updated.length === 0) return { ok: false, reason: "not-found" };
  return { ok: true, token };
}

// Target languages; the source language is fixed and always first. Rows
// for a removed language are kept (nothing here deletes translations):
// adding the language back brings its work back; pull simply skips it.
export function updateLanguages(
  db: Db,
  projectId: number,
  targets: string[],
  actor: Actor,
): SettingsResult {
  if (!isMaintainer(db, actor)) return { ok: false, reason: "forbidden" };
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) return { ok: false, reason: "not-found" };
  const cleaned = targets.map((l) => l.trim());
  if (!cleaned.every((l) => LANGUAGE_RE.test(l))) {
    return { ok: false, reason: "invalid" };
  }
  const languages = [project.sourceLanguage];
  for (const l of cleaned) if (!languages.includes(l)) languages.push(l);
  db.update(projects)
    .set({ languages })
    .where(eq(projects.id, projectId))
    .run();
  return { ok: true };
}

// The one user flag (§10). A maintainer may toggle others and step down,
// but never leave the instance without a maintainer.
export function setMaintainer(
  db: Db,
  userId: number,
  maintainer: boolean,
  actor: Actor,
): SettingsResult {
  if (!isMaintainer(db, actor)) return { ok: false, reason: "forbidden" };
  const target = db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) return { ok: false, reason: "not-found" };
  if (!maintainer && target.maintainer) {
    const remaining = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.maintainer, true))
      .all()
      .filter((u) => u.id !== userId).length;
    if (remaining === 0) return { ok: false, reason: "last-maintainer" };
  }
  db.update(users).set({ maintainer }).where(eq(users.id, userId)).run();
  // A demoted maintainer's open sessions still carry the old flag until
  // their next request; ending them makes the change take effect now.
  if (!maintainer && target.maintainer) endSessionsOf(db, userId);
  return { ok: true };
}

// A maintainer issues a temporary password (§10): it ends the person's
// sessions and must be replaced at their next sign-in.
export function resetUserPassword(
  db: Db,
  userId: number,
  actor: Actor,
): SettingsResult<{ temporary: string }> {
  if (!isMaintainer(db, actor)) return { ok: false, reason: "forbidden" };
  const target = db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) return { ok: false, reason: "not-found" };
  return { ok: true, temporary: resetPassword(db, userId) };
}
