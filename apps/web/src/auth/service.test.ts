import { expect, test } from "vitest";
import { memoryDb } from "@/db/test-helpers";
import { sessions, users } from "@/db/schema";
import {
  createSession,
  endSession,
  endSessionsOf,
  getSessionUser,
  joinInstance,
  resetPassword,
  SESSION_TTL_MS,
  setPassword,
  signIn,
} from "./service";

const SECRET = "the-instance-secret";
const join = (
  db: ReturnType<typeof memoryDb>,
  name: string,
  password = "long enough",
) =>
  joinInstance(db, {
    instanceSecret: SECRET,
    providedSecret: SECRET,
    name,
    password,
  });

test("wrong secret is rejected and creates no user", () => {
  const db = memoryDb();
  const result = joinInstance(db, {
    instanceSecret: SECRET,
    providedSecret: "nope",
    name: "ana",
    password: "long enough",
  });
  expect(result).toEqual({ ok: false, reason: "invalid-secret" });
  expect(signIn(db, { name: "ana", password: "long enough" }).ok).toBe(false);
});

test("an empty name or a short password is rejected even with the right secret", () => {
  const db = memoryDb();
  expect(join(db, "   ")).toEqual({ ok: false, reason: "invalid-name" });
  expect(join(db, "ana", "short")).toEqual({
    ok: false,
    reason: "weak-password",
  });
});

test("the first account is the maintainer, the second is not", () => {
  const db = memoryDb();
  const first = join(db, "ana");
  const second = join(db, "bruno");
  expect(first.ok && first.user.maintainer).toBe(true);
  expect(second.ok && second.user.maintainer).toBe(false);
});

test("a taken name is refused, so nobody can become someone else by joining", () => {
  const db = memoryDb();
  join(db, "ana");
  expect(join(db, "ana", "another password")).toEqual({
    ok: false,
    reason: "name-taken",
  });
  expect(join(db, "ana")).toEqual({ ok: false, reason: "name-taken" });
});

test("signing in needs the right name and password", () => {
  const db = memoryDb();
  join(db, "ana");
  const good = signIn(db, { name: "ana", password: "long enough" });
  expect(good.ok && good.user.name).toBe("ana");
  expect(good.ok && good.mustChangePassword).toBe(false);
  expect(signIn(db, { name: "ana", password: "long enough!" })).toEqual({
    ok: false,
    reason: "invalid-credentials",
  });
  expect(signIn(db, { name: "nobody", password: "long enough" })).toEqual({
    ok: false,
    reason: "invalid-credentials",
  });
});

test("an account from before passwords is claimed once by the secret and a new password", () => {
  const db = memoryDb();
  const legacy = join(db, "ana");
  if (!legacy.ok) throw new Error("seed failed");
  db.update(users).set({ passwordHash: null }).run();
  expect(signIn(db, { name: "ana", password: "long enough" }).ok).toBe(false);
  const claimed = join(db, "ana", "fresh password");
  expect(claimed.ok && claimed.user.id).toBe(legacy.user.id);
  expect(signIn(db, { name: "ana", password: "fresh password" }).ok).toBe(true);
  expect(join(db, "ana", "yet another")).toEqual({
    ok: false,
    reason: "name-taken",
  });
});

test("a reset hands out a temporary password once, ends the sessions, and forces a change", () => {
  const db = memoryDb();
  const joined = join(db, "ana");
  if (!joined.ok) throw new Error("seed failed");
  const token = createSession(db, joined.user.id);
  const temporary = resetPassword(db, joined.user.id);
  expect(getSessionUser(db, token)).toBeUndefined();
  expect(signIn(db, { name: "ana", password: "long enough" }).ok).toBe(false);
  const next = signIn(db, { name: "ana", password: temporary });
  expect(next.ok && next.mustChangePassword).toBe(true);
  expect(setPassword(db, joined.user.id, "chosen by ana")).toEqual({
    ok: true,
  });
  const after = signIn(db, { name: "ana", password: "chosen by ana" });
  expect(after.ok && after.mustChangePassword).toBe(false);
  expect(signIn(db, { name: "ana", password: temporary }).ok).toBe(false);
});

test("session round-trips, is stored only as a hash, and ends on sign-out", () => {
  const db = memoryDb();
  const joined = join(db, "ana");
  if (!joined.ok) throw new Error("seed failed");
  const token = createSession(db, joined.user.id);
  expect(getSessionUser(db, token)?.name).toBe("ana");
  const rows = db.select().from(sessions).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.tokenHash).not.toBe(token);
  endSession(db, token);
  expect(getSessionUser(db, token)).toBeUndefined();
  expect(getSessionUser(db, "unknown")).toBeUndefined();
});

test("a session expires after ninety days of disuse and is renewed by use", () => {
  const db = memoryDb();
  const joined = join(db, "ana");
  if (!joined.ok) throw new Error("seed failed");
  const start = new Date("2026-01-01T00:00:00Z");
  const token = createSession(db, joined.user.id, start);
  const day = 24 * 60 * 60 * 1000;
  expect(
    getSessionUser(db, token, new Date(start.getTime() + SESSION_TTL_MS + day)),
  ).toBeUndefined();
  const token2 = createSession(db, joined.user.id, start);
  // Used on day 60: renewed, so day 120 still works; unused after that, day 160 does not.
  expect(
    getSessionUser(db, token2, new Date(start.getTime() + 60 * day))?.name,
  ).toBe("ana");
  expect(
    getSessionUser(db, token2, new Date(start.getTime() + 120 * day))?.name,
  ).toBe("ana");
  expect(
    getSessionUser(
      db,
      token2,
      new Date(start.getTime() + 160 * day + 90 * day),
    ),
  ).toBeUndefined();
});

test("ending a user's sessions leaves other users' sessions alone", () => {
  const db = memoryDb();
  const ana = join(db, "ana");
  const bruno = join(db, "bruno");
  if (!ana.ok || !bruno.ok) throw new Error("seed failed");
  const a = createSession(db, ana.user.id);
  const b = createSession(db, bruno.user.id);
  endSessionsOf(db, ana.user.id);
  expect(getSessionUser(db, a)).toBeUndefined();
  expect(getSessionUser(db, b)?.name).toBe("bruno");
});
