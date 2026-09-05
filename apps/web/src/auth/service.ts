import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { sessions, users } from "@/db/schema";
import { MAX_NAME_LENGTH } from "./constants";
import {
  hashPassword,
  passwordProblem,
  temporaryPassword,
  verifyPassword,
} from "./password";

export type User = typeof users.$inferSelect;

// Ninety days, renewed on use (§10): an active translator never sees it
// expire; a session that stops being used does.
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Renewal writes are skipped while the session has more than this left.
const RENEW_WHEN_LESS_THAN_MS = SESSION_TTL_MS - 24 * 60 * 60 * 1000;

export type JoinResult =
  | { ok: true; user: User }
  | {
      ok: false;
      reason:
        "invalid-secret" | "invalid-name" | "name-taken" | "weak-password";
    };

export type SignInResult =
  | { ok: true; user: User; mustChangePassword: boolean }
  | { ok: false; reason: "invalid-credentials" | "weak-password" };

function secretsMatch(instanceSecret: string, providedSecret: string): boolean {
  const a = Buffer.from(instanceSecret);
  const b = Buffer.from(providedSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function validName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME_LENGTH;
}

// Join the instance (§10): the invite secret admits a new name with a
// password of its own; the first account is the maintainer. A name that
// exists is refused, unless it has no password yet (an account from
// before passwords existed), in which case the secret plus a new
// password claims it once.
export function joinInstance(
  db: Db,
  input: {
    instanceSecret: string;
    providedSecret: string;
    name: string;
    password: string;
  },
): JoinResult {
  const name = input.name.trim();
  if (!validName(name)) return { ok: false, reason: "invalid-name" };
  if (!secretsMatch(input.instanceSecret, input.providedSecret)) {
    return { ok: false, reason: "invalid-secret" };
  }
  if (passwordProblem(input.password)) {
    return { ok: false, reason: "weak-password" };
  }
  const existing = db.select().from(users).where(eq(users.name, name)).get();
  if (existing) {
    if (existing.passwordHash !== null)
      return { ok: false, reason: "name-taken" };
    const claimed = db
      .update(users)
      .set({
        passwordHash: hashPassword(input.password),
        passwordTemporary: false,
      })
      .where(eq(users.id, existing.id))
      .returning()
      .get();
    return { ok: true, user: claimed! };
  }
  const isFirstUser = db.select().from(users).limit(1).get() === undefined;
  const created = db
    .insert(users)
    .values({
      name,
      maintainer: isFirstUser,
      passwordHash: hashPassword(input.password),
    })
    .returning()
    .get();
  return { ok: true, user: created };
}

// Sign in with name and password (§10). The hash is verified even when
// the name is unknown, so timing does not say which half was wrong.
export function signIn(
  db: Db,
  input: { name: string; password: string },
): SignInResult {
  const name = input.name.trim();
  const user = validName(name)
    ? db.select().from(users).where(eq(users.name, name)).get()
    : undefined;
  const stored = user?.passwordHash ?? DECOY_HASH;
  const ok = verifyPassword(input.password, stored) && user !== undefined;
  if (!ok || !user) return { ok: false, reason: "invalid-credentials" };
  return { ok: true, user, mustChangePassword: user.passwordTemporary };
}

const DECOY_HASH = hashPassword(randomBytes(16).toString("hex"));

export function setPassword(
  db: Db,
  userId: number,
  password: string,
): { ok: true } | { ok: false; reason: "weak-password" } {
  if (passwordProblem(password)) return { ok: false, reason: "weak-password" };
  db.update(users)
    .set({ passwordHash: hashPassword(password), passwordTemporary: false })
    .where(eq(users.id, userId))
    .run();
  return { ok: true };
}

// A maintainer's reset: a temporary password shown once, every session
// of that user ended, and the next sign-in must choose a new password.
export function resetPassword(db: Db, userId: number): string {
  const temporary = temporaryPassword();
  db.update(users)
    .set({ passwordHash: hashPassword(temporary), passwordTemporary: true })
    .where(eq(users.id, userId))
    .run();
  endSessionsOf(db, userId);
  return temporary;
}

// Create a session and return the raw token for the cookie; only its
// hash is stored (§10). Logins are rare, so each one also sweeps
// expired sessions — the table stays bounded without a scheduler.
export function createSession(
  db: Db,
  userId: number,
  now: Date = new Date(),
): string {
  db.delete(sessions).where(lte(sessions.expiresAt, now)).run();
  const token = randomBytes(32).toString("hex");
  db.insert(sessions)
    .values({
      tokenHash: hashToken(token),
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    })
    .run();
  return token;
}

export function getSessionUser(
  db: Db,
  token: string,
  now: Date = new Date(),
): User | undefined {
  const tokenHash = hashToken(token);
  const row = db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .get();
  if (!row) return undefined;
  if (row.expiresAt.getTime() - now.getTime() < RENEW_WHEN_LESS_THAN_MS) {
    db.update(sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(sessions.tokenHash, tokenHash))
      .run();
  }
  return row.user;
}

export function endSession(db: Db, token: string): void {
  db.delete(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .run();
}

export function endSessionsOf(db: Db, userId: number): void {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}
