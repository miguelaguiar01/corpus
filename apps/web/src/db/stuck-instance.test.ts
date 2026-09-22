// #525 left instances with no maintainer and no way to get one. The
// recovery is a data migration, so it runs once against a database that
// already exists. The first four build that state and run the statement
// directly, for what it does; the last opens a database migrated only as
// far as 0012 and lets migrate() find it, for whether it runs at all.
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import { users } from "./schema";
import { MIGRATIONS_DIR, fileDb, memoryDb } from "./test-helpers";

const recovery = readFileSync(
  path.join(MIGRATIONS_DIR, "0013_promote-first-person-when-no-maintainer.sql"),
  "utf8",
);

function instance(
  rows: { name: string; maintainer: boolean; agent: boolean }[],
) {
  const db = memoryDb();
  for (const row of rows) db.insert(users).values(row).run();
  return db;
}

function promoted(db: ReturnType<typeof memoryDb>): string[] {
  db.run(sql.raw(recovery));
  return db
    .select()
    .from(users)
    .all()
    .filter((row) => row.maintainer)
    .map((row) => row.name);
}

test("the stuck instance gets its person back as maintainer", () => {
  const db = instance([
    { name: "acme-app agent", maintainer: false, agent: true },
    { name: "ana", maintainer: false, agent: false },
    { name: "bruno", maintainer: false, agent: false },
  ]);
  expect(promoted(db)).toEqual(["ana"]);
});

test("an instance that already has a maintainer is left alone", () => {
  const db = instance([
    { name: "acme-app agent", maintainer: false, agent: true },
    { name: "ana", maintainer: false, agent: false },
    { name: "bruno", maintainer: true, agent: false },
  ]);
  expect(promoted(db)).toEqual(["bruno"]);
});

test("the agent actor is never promoted, even when it is alone", () => {
  const db = instance([
    { name: "acme-app agent", maintainer: false, agent: true },
  ]);
  expect(promoted(db)).toEqual([]);
});

test("running it twice changes nothing the second time", () => {
  const db = instance([
    { name: "acme-app agent", maintainer: false, agent: true },
    { name: "ana", maintainer: false, agent: false },
  ]);
  expect(promoted(db)).toEqual(["ana"]);
  expect(promoted(db)).toEqual(["ana"]);
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-stuck-"));
  dirs.push(dir);
  return dir;
}

// The four above run the file. This runs the migration, which is a
// different thing: a .sql nobody lists in _journal.json is never applied,
// so the journal entry is the feature and the others cannot see it.
test("opening a stuck database repairs it, through migrate", () => {
  const before = scratch();
  cpSync(MIGRATIONS_DIR, before, { recursive: true });
  const journal = JSON.parse(
    readFileSync(path.join(before, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter(
    (entry) => !entry.tag.startsWith("0013_"),
  );
  writeFileSync(
    path.join(before, "meta", "_journal.json"),
    JSON.stringify(journal, null, 2),
  );

  // An instance as it was before the fix: migrated only as far as 0012,
  // with the actor the project created and the person who joined after.
  const file = path.join(scratch(), "corpus.db");
  const old = fileDb(file, before);
  old.insert(users).values({ name: "acme-app agent", agent: true }).run();
  old.insert(users).values({ name: "ana" }).run();
  expect(
    old
      .select()
      .from(users)
      .all()
      .map((row) => row.maintainer),
  ).toEqual([false, false]);

  const upgraded = fileDb(file);
  expect(
    upgraded
      .select()
      .from(users)
      .all()
      .filter((row) => row.maintainer)
      .map((row) => row.name),
  ).toEqual(["ana"]);
});
