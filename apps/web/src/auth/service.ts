import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { sessions, users } from "@/db/schema";

export type User = typeof users.$inferSelect;

export const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // one year (§10: long-lived)

export type InviteResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid-secret" | "invalid-name" };

function secretsMatch(instanceSecret: string, providedSecret: string): boolean {
  const a = Buffer.from(instanceSecret);
  const b = Buffer.from(providedSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Redeem the instance invite secret for a user (§10): create the named
// user or reuse it; the first user ever created becomes a maintainer.
export function redeemInvite(
  db: Db,
  input: { instanceSecret: string; providedSecret: string; name: string },
): InviteResult {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) {
    return { ok: false, reason: "invalid-name" };
  }
  if (!secretsMatch(input.instanceSecret, input.providedSecret)) {
    return { ok: false, reason: "invalid-secret" };
  }

  const existing = db.select().from(users).where(eq(users.name, name)).get();
  if (existing) return { ok: true, user: existing };

  const isFirstUser = db.select().from(users).limit(1).all().length === 0;
  const created = db
    .insert(users)
    .values({ name, maintainer: isFirstUser })
    .returning()
    .get();
  return { ok: true, user: created };
}

// Create a session and return the raw token for the cookie; only its
// hash is stored (§10).
export function createSession(
  db: Db,
  userId: number,
  now: Date = new Date(),
): string {
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
  const row = db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .get();
  if (!row || row.expiresAt.getTime() <= now.getTime()) return undefined;
  return row.user;
}
