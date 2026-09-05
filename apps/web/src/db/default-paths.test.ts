import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { openDb, resolvedPaths } from "./index";
import { users } from "./schema";

// Acceptance line of #129: the defaults hold from a foreign working
// directory. The database file is redirected to a temp dir so the test
// never touches apps/web/data; the migrations folder is left to resolve.
let tmp: string;
let cwd: string;
afterEach(() => {
  process.chdir(cwd);
  rmSync(tmp, { recursive: true, force: true });
});

test("openDb finds its migrations from a foreign cwd", () => {
  cwd = process.cwd();
  tmp = mkdtempSync(path.join(os.tmpdir(), "corpus-default-paths-"));
  process.chdir(os.tmpdir());
  const paths = resolvedPaths();
  expect(
    paths.migrationsDir.endsWith(path.join("apps", "web", "drizzle")),
  ).toBe(true);
  const db = openDb(path.join(tmp, "corpus.db"));
  expect(db.select().from(users).all()).toEqual([]);
});
