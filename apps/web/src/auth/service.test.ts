import { expect, test } from "vitest";
import { sessions, users } from "@/db/schema";
import { memoryDb as db } from "@/db/test-helpers";
import {
  createSession,
  getSessionUser,
  redeemInvite,
  SESSION_TTL_MS,
} from "./service";

const SECRET = "top-secret";

test("wrong secret is rejected and creates no user", () => {
  const d = db();
  const result = redeemInvite(d, {
    instanceSecret: SECRET,
    providedSecret: "wrong",
    name: "miguel",
  });
  expect(result.ok).toBe(false);
  expect(d.select().from(users).all()).toHaveLength(0);
});

test("empty name is rejected even with the right secret", () => {
  const d = db();
  const result = redeemInvite(d, {
    instanceSecret: SECRET,
    providedSecret: SECRET,
    name: "   ",
  });
  expect(result.ok).toBe(false);
  expect(d.select().from(users).all()).toHaveLength(0);
});

test("first user created on the instance is a maintainer", () => {
  const d = db();
  const result = redeemInvite(d, {
    instanceSecret: SECRET,
    providedSecret: SECRET,
    name: "miguel",
  });
  if (!result.ok) throw new Error("expected success");
  expect(result.user.maintainer).toBe(true);
});

test("second user is not a maintainer", () => {
  const d = db();
  redeemInvite(d, {
    instanceSecret: SECRET,
    providedSecret: SECRET,
    name: "miguel",
  });
  const second = redeemInvite(d, {
    instanceSecret: SECRET,
    providedSecret: SECRET,
    name: "ana",
  });
  if (!second.ok) throw new Error("expected success");
  expect(second.user.maintainer).toBe(false);
});

test("same name reuses the existing user instead of creating another", () => {
  const d = db();
  const first = redeemInvite(d, {
    instanceSecret: SECRET,
    providedSecret: SECRET,
    name: "miguel",
  });
  const again = redeemInvite(d, {
    instanceSecret: SECRET,
    providedSecret: SECRET,
    name: "miguel",
  });
  if (!first.ok || !again.ok) throw new Error("expected success");
  expect(again.user.id).toBe(first.user.id);
  expect(again.user.maintainer).toBe(true);
  expect(d.select().from(users).all()).toHaveLength(1);
});

test("session round-trips: created token resolves to its user", () => {
  const d = db();
  const invited = redeemInvite(d, {
    instanceSecret: SECRET,
    providedSecret: SECRET,
    name: "miguel",
  });
  if (!invited.ok) throw new Error("expected success");
  const token = createSession(d, invited.user.id);
  const found = getSessionUser(d, token);
  expect(found?.id).toBe(invited.user.id);
});

test("the raw session token is never stored in the database", () => {
  const d = db();
  const invited = redeemInvite(d, {
    instanceSecret: SECRET,
    providedSecret: SECRET,
    name: "miguel",
  });
  if (!invited.ok) throw new Error("expected success");
  const token = createSession(d, invited.user.id);
  const stored = d.select().from(sessions).all();
  expect(stored).toHaveLength(1);
  expect(stored[0]?.tokenHash).not.toBe(token);
  expect(stored[0]?.tokenHash).not.toContain(token);
});

test("an unknown token resolves to no user", () => {
  const d = db();
  expect(getSessionUser(d, "made-up-token")).toBeUndefined();
});

test("an expired session resolves to no user", () => {
  const d = db();
  const invited = redeemInvite(d, {
    instanceSecret: SECRET,
    providedSecret: SECRET,
    name: "miguel",
  });
  if (!invited.ok) throw new Error("expected success");
  const token = createSession(d, invited.user.id);
  const afterExpiry = new Date(Date.now() + SESSION_TTL_MS + 1000);
  expect(getSessionUser(d, token, afterExpiry)).toBeUndefined();
});
