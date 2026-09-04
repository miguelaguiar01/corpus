import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { sessions, users } from "./schema";
import { fileDb, memoryDb } from "./test-helpers";

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
  const expires = new Date("2030-01-01T00:00:00Z");
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
  // A container restart re-runs migrate() against the volume-mounted
  // file; it must be a no-op that preserves data (review note on #24).
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "corpus-db-test-")),
    "corpus.db",
  );
  try {
    const first = fileDb(file);
    first.insert(users).values({ name: "kept" }).run();
    const reopened = fileDb(file);
    expect(reopened.select().from(users).all()).toHaveLength(1);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});
