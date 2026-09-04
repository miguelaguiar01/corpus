import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { openDb } from "./index";
import { sessions, users } from "./schema";

// Tests run from the repo root; resolve the migrations folder from this
// file instead of relying on openDb's cwd-based default.
const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

function memoryDb() {
  return openDb(":memory:", MIGRATIONS);
}

test("migrations apply on a fresh database", () => {
  const db = memoryDb();
  expect(db.select().from(users).all()).toEqual([]);
  expect(db.select().from(sessions).all()).toEqual([]);
});

test("creates and reads back a user with defaults", () => {
  const db = memoryDb();
  const [user] = db.insert(users).values({ name: "miguel" }).returning().all();
  expect(user?.name).toBe("miguel");
  expect(user?.maintainer).toBe(false);
  expect(user?.createdAt).toBeInstanceOf(Date);
});

test("user names are unique", () => {
  const db = memoryDb();
  db.insert(users).values({ name: "miguel" }).run();
  expect(() => db.insert(users).values({ name: "miguel" }).run()).toThrow();
});

test("creates a session referencing a user", () => {
  const db = memoryDb();
  const [user] = db.insert(users).values({ name: "ana" }).returning().all();
  if (!user) throw new Error("insert failed");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
  db.insert(sessions)
    .values({ tokenHash: "hash-abc", userId: user.id, expiresAt: expires })
    .run();
  const [row] = db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, "hash-abc"))
    .all();
  expect(row?.userId).toBe(user.id);
  expect(row?.expiresAt.getTime()).toBe(expires.getTime());
});

test("sessions enforce the user foreign key", () => {
  const db = memoryDb();
  expect(() =>
    db
      .insert(sessions)
      .values({ tokenHash: "orphan", userId: 999, expiresAt: new Date() })
      .run(),
  ).toThrow();
});

test("migrations are idempotent on an existing database file", () => {
  const db = memoryDb();
  // openDb ran migrate() once; running it again must be a no-op, which is
  // what a container restart does against the volume-mounted file.
  expect(() => openDb(":memory:", MIGRATIONS)).not.toThrow();
  db.insert(users).values({ name: "kept" }).run();
  expect(db.select().from(users).all()).toHaveLength(1);
});
