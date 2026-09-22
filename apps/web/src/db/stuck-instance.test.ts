// #525 left instances with no maintainer and no way to get one. The
// recovery is a data migration, so it runs once against a database that
// already exists; these build that database the way the bug did and
// re-run the migration against it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { users } from "./schema";
import { MIGRATIONS_DIR, memoryDb } from "./test-helpers";

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
